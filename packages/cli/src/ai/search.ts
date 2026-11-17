/**
 * Web search for the assistant, from the provider picked in the panel:
 *
 *   openrouter  OpenRouter's « web » plugin: the search happens inside the model call (no extra key)
 *   brave       Brave Search API (BRAVE_API_KEY)
 *   tavily      Tavily (TAVILY_API_KEY)
 *
 * For Brave and Tavily the studio searches itself, with the user's question, and hands the
 * results to the model in the message (title, address, excerpt): it works with every model.
 * Keys are read from the environment, like the OpenRouter key: never written, never sent to the browser.
 */
import { aiAvailable } from './openrouter.js';

export const SEARCH_PROVIDERS = ['openrouter', 'brave', 'tavily'] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

export const SEARCH_LABELS: Record<SearchProvider, string> = {
  openrouter: 'OpenRouter',
  brave: 'Brave Search',
  tavily: 'Tavily',
};

/** Results given to the model. */
const RESULTS = 5;
const TIMEOUT_MS = 15_000;

const env = (...names: string[]): string | undefined => names.map((n) => process.env[n]).find(Boolean);
const braveKey = (): string | undefined => env('BRAVE_API_KEY', 'BRAVE_SEARCH_API_KEY');
const tavilyKey = (): string | undefined => env('TAVILY_API_KEY');

/** Providers whose key is set, in the panel's order. */
export function searchProviders(): SearchProvider[] {
  return SEARCH_PROVIDERS.filter((p) =>
    p === 'openrouter' ? aiAvailable() : p === 'brave' ? Boolean(braveKey()) : Boolean(tavilyKey()),
  );
}

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

/** What to search: the question itself, shortened to what the APIs accept (Brave: 400 characters). */
const searchQuery = (question: string): string => {
  const flat = question.replace(/\s+/g, ' ').trim();
  return flat.length <= 380 ? flat : flat.slice(0, 380).replace(/\s\S*$/, '');
};

/** Searches with Brave or Tavily (OpenRouter searches inside the model call instead). */
export async function webSearch(
  provider: Exclude<SearchProvider, 'openrouter'>,
  question: string,
  language: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const q = searchQuery(question);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  if (provider === 'brave') {
    const key = braveKey();
    if (!key) throw new Error('Brave Search : pas de clé (BRAVE_API_KEY)');
    const base = process.env.BRAVE_SEARCH_URL ?? 'https://api.search.brave.com/res/v1/web/search';
    const url = `${base}?${new URLSearchParams({ q, count: String(RESULTS), search_lang: language.slice(0, 2) })}`;
    const res = await fetch(url, { headers: { accept: 'application/json', 'x-subscription-token': key }, signal: sig });
    if (!res.ok) throw new Error(`Brave Search : ${httpReason(res.status)}`);
    const body = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (body.web?.results ?? []).slice(0, RESULTS).map((r) => ({
      title: clean(r.title ?? ''),
      url: r.url ?? '',
      snippet: clean(r.description ?? ''),
    }));
  }
  const key = tavilyKey();
  if (!key) throw new Error('Tavily : pas de clé (TAVILY_API_KEY)');
  const res = await fetch(process.env.TAVILY_SEARCH_URL ?? 'https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: q, max_results: RESULTS, search_depth: 'basic' }),
    signal: sig,
  });
  if (!res.ok) throw new Error(`Tavily : ${httpReason(res.status)}`);
  const body = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return (body.results ?? []).slice(0, RESULTS).map((r) => ({
    title: clean(r.title ?? ''),
    url: r.url ?? '',
    snippet: clean(r.content ?? '').slice(0, 600),
  }));
}

/** Brave marks the matched words with <strong>; the model only needs the text. */
const clean = (s: string): string =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

function httpReason(status: number): string {
  if (status === 401 || status === 403) return `clé refusée (${status})`;
  if (status === 429) return 'quota ou limite de requêtes atteint (429)';
  return `HTTP ${status}`;
}

/** The results as the model reads them, before the question. */
export function searchContext(provider: SearchProvider, results: readonly SearchResult[]): string {
  if (results.length === 0) return `Recherche web (${SEARCH_LABELS[provider]}) : aucun résultat.`;
  return `Résultats d'une recherche web (${SEARCH_LABELS[provider]}) sur la question ci-dessous. Appuie-toi dessus quand ils sont pertinents et cite les sources utilisées en liens Markdown ; dis-le si rien ne répond à la question.

${results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.snippet}`).join('\n\n')}`;
}
