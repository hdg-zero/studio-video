/**
 * OpenRouter chat client (one HTTP API in front of most models), used by the studio's assistant.
 *
 * The key is read from the environment, like the voice: it never reaches the browser nor a file.
 * Responses are streamed (server-sent events) so the assistant's answer appears as it is written.
 */
import { apiKey, apiKeyAvailable } from '../core/tts.js';
import { sleep } from '../core/util.js';

const BASE = (): string => process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly context: number;
  /** US dollars per million tokens (prompt, completion); 0 for free models. */
  readonly prompt: number;
  readonly completion: number;
  readonly created: number;
}

export interface Usage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Prompt tokens read from the provider's cache (billed at a fraction of the price). */
  readonly cachedTokens: number;
  /** US dollars, when OpenRouter reports it. */
  readonly cost?: number;
}

const headers = (): Record<string, string> => ({
  authorization: `Bearer ${apiKey()}`,
  'content-type': 'application/json',
  // shown in the OpenRouter dashboard
  'x-title': 'Studio vidéo',
  'http-referer': 'http://127.0.0.1/studio-video',
});

export const aiAvailable = apiKeyAvailable;

let modelsCache: { at: number; list: ModelInfo[] } | null = null;

/** Text-output models offered by OpenRouter, newest first (cached for an hour). */
export async function listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  if (modelsCache && Date.now() - modelsCache.at < 3_600_000) return modelsCache.list;
  const res = await fetch(`${BASE()}/models`, { signal: signal ?? AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`OpenRouter: liste des modèles indisponible (HTTP ${res.status})`);
  const body = (await res.json()) as {
    data?: {
      id: string;
      name?: string;
      created?: number;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
      architecture?: { output_modalities?: string[] };
    }[];
  };
  const list = (body.data ?? [])
    .filter((m) => m.architecture?.output_modalities?.includes('text') ?? true)
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      context: m.context_length ?? 0,
      prompt: Number(m.pricing?.prompt ?? 0) * 1e6,
      completion: Number(m.pricing?.completion ?? 0) * 1e6,
      created: m.created ?? 0,
    }))
    .sort((a, b) => b.created - a.created);
  modelsCache = { at: Date.now(), list };
  return list;
}

/** `$STUDIO_AI_MODEL`, else the newest Claude Sonnet offered, else OpenRouter's automatic router. */
export function defaultModel(models: readonly ModelInfo[]): string {
  if (process.env.STUDIO_AI_MODEL) return process.env.STUDIO_AI_MODEL;
  return models.find((m) => /^anthropic\/claude-sonnet/.test(m.id))?.id ?? 'openrouter/auto';
}

/** A text part of a message; `cache` marks the end of a prefix worth caching (Anthropic, Gemini). */
export interface TextPart {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control?: { readonly type: 'ephemeral' };
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string | readonly TextPart[];
}

/** Providers that cache a prompt prefix only when asked; the others (OpenAI, DeepSeek…) do it themselves. */
export const explicitCache = (model: string): boolean => /^(anthropic|google)\//.test(model);

export interface ChatOptions {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly signal?: AbortSignal;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Searches the web first and gives the results to the model (OpenRouter « web » plugin). */
  readonly web?: boolean;
  /** Called before a new attempt after a transient failure. */
  readonly onRetry?: (message: string) => void;
}

export type ChatChunk =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'usage'; readonly usage: Usage }
  /** The model that actually answers (as OpenRouter names it). */
  | { readonly type: 'model'; readonly model: string }
  /** `length` means the answer was cut by the token limit. */
  | { readonly type: 'finish'; readonly reason: string };

/** Pages read per web search (OpenRouter bills each result). */
const WEB_RESULTS = 5;

const RETRIABLE = new Set([408, 429, 500, 502, 503, 504]);
const ATTEMPTS = 3;
/** No byte for this long (OpenRouter sends keep-alive comments every few seconds): give up. */
const IDLE_MS = 90_000;

/** Streams the completion: model, text deltas, finish reason, then usage when reported. */
export async function* chatStream(opts: ChatOptions): AsyncGenerator<ChatChunk> {
  const idle = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const touch = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(new Error('OpenRouter ne répond plus (aucune donnée depuis 90 s)')), IDLE_MS);
  };
  const signal = opts.signal ? AbortSignal.any([opts.signal, idle.signal]) : idle.signal;
  try {
    touch();
    const res = await request(opts, signal);
    if (!res.body) throw new Error('OpenRouter : réponse vide');
    const decoder = new TextDecoder();
    let buffer = '';
    let model = '';
    let finished = false;
    for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
      touch();
      buffer += decoder.decode(part, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        // comments (": OPENROUTER PROCESSING") keep the connection alive
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        const chunk = parseChunk(data);
        if (chunk.error) throw new Error(`OpenRouter : ${chunk.error}`);
        if (chunk.model && chunk.model !== model) {
          model = chunk.model;
          yield { type: 'model', model };
        }
        if (chunk.text) yield { type: 'delta', text: chunk.text };
        if (chunk.finish) {
          finished = true;
          yield { type: 'finish', reason: chunk.finish };
        }
        if (chunk.usage) yield { type: 'usage', usage: chunk.usage };
      }
    }
    // the stream ended without its last event: the connection was cut
    if (!finished) throw new Error('OpenRouter : connexion interrompue');
  } catch (err) {
    if (idle.signal.aborted && !opts.signal?.aborted) throw idle.signal.reason as Error;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Sends the request, retrying transient failures (network, rate limit, overload) with backoff. */
async function request(opts: ChatOptions, signal: AbortSignal): Promise<Response> {
  const body = JSON.stringify({
    model: opts.model,
    messages: opts.messages,
    stream: true,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 8192,
    usage: { include: true },
    // the model is told to cite its sources as Markdown links
    ...(opts.web ? { plugins: [{ id: 'web', max_results: WEB_RESULTS }] } : {}),
  });
  for (let attempt = 1; ; attempt++) {
    let res: Response | null = null;
    let failure: string;
    try {
      res = await fetch(`${BASE()}/chat/completions`, { method: 'POST', headers: headers(), body, signal });
      if (res.ok) return res;
      failure = httpError(res.status, await res.text().catch(() => ''), opts.model);
    } catch (err) {
      if (signal.aborted) throw err;
      failure = `OpenRouter injoignable (${err instanceof Error ? err.message : String(err)})`;
    }
    if ((res && !RETRIABLE.has(res.status)) || attempt >= ATTEMPTS) throw new Error(failure);
    const wait = Number(res?.headers.get('retry-after')) * 1000 || 1500 * 2 ** (attempt - 1);
    opts.onRetry?.(`${failure} : nouvel essai dans ${Math.round(wait / 1000)} s`);
    await sleep(Math.min(wait, 20_000), signal);
  }
}

/** HTTP failures in words that say what to do. */
function httpError(status: number, body: string, model: string): string {
  const detail = describeError(body);
  switch (status) {
    case 401:
      return 'OpenRouter : clé refusée (401). Vérifier OPENROUTER_API_KEY.';
    case 402:
      return 'OpenRouter : crédit insuffisant (402). Recharger le compte ou choisir un modèle gratuit (suffixe :free).';
    case 404:
      return `OpenRouter : modèle « ${model} » introuvable ou indisponible (404). En choisir un autre${detail}`;
    case 413:
      return 'OpenRouter : conversation trop longue pour ce modèle (413). Démarrer une nouvelle conversation.';
    case 429:
      return `OpenRouter : trop de requêtes (429)${detail}`;
    default:
      if (status === 400 && /context|token/i.test(detail))
        return `OpenRouter : conversation trop longue pour ce modèle${detail}. Démarrer une nouvelle conversation.`;
      return `OpenRouter : HTTP ${status}${detail}`;
  }
}

/** Parses one streamed `data:` payload (exported for tests). */
export function parseChunk(data: string): {
  text?: string;
  usage?: Usage;
  error?: string;
  model?: string;
  finish?: string;
} {
  let json: {
    model?: string;
    choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
    error?: { message?: string };
  };
  try {
    json = JSON.parse(data) as typeof json;
  } catch {
    return {};
  }
  if (json.error) return { error: json.error.message ?? 'erreur inconnue' };
  const choice = json.choices?.[0];
  const text = choice?.delta?.content ?? undefined;
  const u = json.usage;
  return {
    ...(json.model ? { model: json.model } : {}),
    ...(text ? { text } : {}),
    ...(choice?.finish_reason ? { finish: choice.finish_reason } : {}),
    ...(u
      ? {
          usage: {
            promptTokens: u.prompt_tokens ?? 0,
            completionTokens: u.completion_tokens ?? 0,
            cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
            ...(u.cost !== undefined ? { cost: u.cost } : {}),
          },
        }
      : {}),
  };
}

/** Sum of the usage of several calls (an answer and its automatic corrections). */
export function addUsage(a: Usage | null, b: Usage): Usage {
  if (!a) return b;
  const cost = a.cost === undefined && b.cost === undefined ? undefined : (a.cost ?? 0) + (b.cost ?? 0);
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    ...(cost !== undefined ? { cost } : {}),
  };
}

function describeError(body: string): string {
  try {
    const msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message;
    if (msg) return `: ${msg}`;
  } catch {
    // not JSON
  }
  return body ? `: ${body.slice(0, 200)}` : '';
}
