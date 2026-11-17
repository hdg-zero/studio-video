/** Assistant choices remembered in this browser: the model and the web search. */
import type { SearchProvider } from '../../cli/src/ui/protocol.js';

export const MODEL_KEY = 'studio.ai.model';

/** The model picked in this browser, if any (else the server's default). */
export function assistantModel(): string | undefined {
  try {
    return localStorage.getItem(MODEL_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export const WEB_KEY = 'studio.ai.web';

export const SEARCH: Record<SearchProvider, { label: string; hint: string }> = {
  openrouter: {
    label: 'OpenRouter',
    hint: 'Greffon web d’OpenRouter : environ 0,02 $ de plus par question, parfois plus selon le modèle.',
  },
  brave: { label: 'Brave Search', hint: 'API Brave Search (clé BRAVE_API_KEY) : offre gratuite limitée par mois.' },
  tavily: { label: 'Tavily', hint: 'API Tavily (clé TAVILY_API_KEY) : crédits gratuits chaque mois.' },
};

/** The web search picked in this browser, if any (off by default: searches are billed). */
export function assistantWeb(): SearchProvider | undefined {
  try {
    const v = localStorage.getItem(WEB_KEY);
    // « 1 » was the on/off box of 1.6.0
    return v === '1' ? 'openrouter' : v && v in SEARCH ? (v as SearchProvider) : undefined;
  } catch {
    return undefined;
  }
}
