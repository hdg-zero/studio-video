/**
 * Voice-over through OpenRouter's /audio/speech endpoint.
 *
 * Clips are generated in parallel and cached by content: a clip is regenerated only when its
 * text, model or voice changed (sha256 stored in voice/manifest.json), so editing one sentence
 * costs one request instead of twelve.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SegmentSpec } from './config.js';
import { log } from './log.js';
import type { Project } from './project.js';
import { mapLimit, runOrThrow, sha256, sleep, writeFileAtomic } from './util.js';

/**
 * Clips are stored as raw PCM: signed 16-bit little-endian, mono, 44.1 kHz. OpenRouter returns
 * PCM at the model's own rate (44.1 kHz for Fish Audio, 24 kHz for Voxtral…), given in the
 * content-type; other rates are resampled on arrival.
 */
export const PCM_RATE = 44_100;
const ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';

export interface VoiceClip {
  readonly hash: string;
  /** Duration in seconds. */
  readonly dur: number;
}

export interface VoiceManifest {
  readonly model: string;
  readonly voice: string | null;
  readonly clips: Record<string, VoiceClip>;
}

export const clipPath = (project: Project, id: string): string => path.join(project.paths.voice, `${id}.pcm`);
const pcmDuration = (bytes: number): number => Math.round((bytes / 2 / PCM_RATE) * 1000) / 1000;

export function clipHash(model: string, voice: string | undefined, text: string): string {
  return sha256(model, voice ?? '', text);
}

export async function readManifest(project: Project): Promise<VoiceManifest | null> {
  if (!existsSync(project.paths.voiceManifest)) return null;
  return JSON.parse(await readFile(project.paths.voiceManifest, 'utf8')) as VoiceManifest;
}

const keyFromEnv = (): string | undefined => process.env.OPENROUTER_API_KEY ?? process.env.OR_KEY ?? process.env.key_or;

/** Whether voices can be generated (the key itself never leaves this module). */
export const apiKeyAvailable = (): boolean => Boolean(keyFromEnv());

export function apiKey(): string {
  const key = keyFromEnv();
  if (!key) throw new Error('no OpenRouter key: export OPENROUTER_API_KEY=… (never write it in a file of the project)');
  return key;
}

class FatalHttpError extends Error {}

/** Sample rate announced by a PCM content-type such as `audio/pcm;rate=24000`, or null. */
export function pcmRate(contentType: string): number | null {
  const m = /rate=(\d+)/.exec(contentType);
  return m ? Number(m[1]) : null;
}

/** Converts mono 16-bit PCM from `rate` to {@link PCM_RATE} with ffmpeg. */
async function resample(data: Buffer, rate: number, name: string): Promise<Buffer> {
  const dir = path.join(os.tmpdir(), 'studio-tts');
  await mkdir(dir, { recursive: true });
  const src = path.join(dir, `${name}.in.pcm`);
  const dst = path.join(dir, `${name}.out.pcm`);
  try {
    await writeFile(src, data);
    const pcm = ['-f', 's16le', '-ac', '1'];
    await runOrThrow('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      ...pcm,
      '-ar',
      String(rate),
      '-i',
      src,
      ...pcm,
      '-ar',
      String(PCM_RATE),
      dst,
    ]);
    return await readFile(dst);
  } finally {
    await rm(src, { force: true });
    await rm(dst, { force: true });
  }
}

async function synthesize(
  key: string,
  body: Record<string, unknown>,
  id: string,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
      });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok) {
        const msg = `HTTP ${res.status} for "${id}": ${(await res.text()).slice(0, 300)}`;
        // client errors (bad key, no credit, bad voice) will not fix themselves
        if ([400, 401, 402, 403, 404].includes(res.status)) throw new FatalHttpError(msg);
        throw new Error(msg);
      }
      const data = Buffer.from(await res.arrayBuffer());
      if (type.includes('json')) throw new Error(`"${id}": JSON instead of audio: ${data.toString().slice(0, 300)}`);
      const rate = pcmRate(type);
      if (rate === null) log.warn(`"${id}": no sample rate in content-type ${type}, assuming ${PCM_RATE} Hz`);
      return rate === null || rate === PCM_RATE ? data : await resample(data, rate, `${id}.${process.pid}`);
    } catch (err) {
      if (err instanceof FatalHttpError || signal?.aborted) throw err;
      lastError = err;
      log.debug(`retry ${id}: ${(err as Error).message}`);
      await sleep(1000 * 2 ** attempt, signal);
    }
  }
  throw new Error(`voice generation failed for "${id}": ${(lastError as Error).message}`);
}

export interface TtsOptions {
  /** Regenerate these ids even if cached. */
  readonly only?: readonly string[];
  readonly force?: boolean;
  readonly signal?: AbortSignal;
}

export async function generateVoices(project: Project, opts: TtsOptions = {}): Promise<VoiceManifest> {
  const { voice: cfg, segments } = project.capsule;
  if (cfg.model.startsWith('fish-audio/') && !cfg.voice) {
    log.warn('Fish Audio without `voice.voice` picks a random speaker for every clip: set a fixed reference_id');
  }
  await mkdir(project.paths.voice, { recursive: true });
  const previous = (await readManifest(project))?.clips ?? {};
  const clips: Record<string, VoiceClip> = {};

  const todo = segments.filter((s) => {
    const hash = clipHash(cfg.model, cfg.voice, s.text);
    const cached = previous[s.id];
    const fresh = cached?.hash === hash && existsSync(clipPath(project, s.id));
    if (fresh && !opts.force && !opts.only?.includes(s.id)) {
      clips[s.id] = cached;
      return false;
    }
    return true;
  });
  log.info(`${segments.length - todo.length} clip(s) en cache, ${todo.length} à générer (${cfg.model})`);
  if (todo.length === 0) return save(project, clips);

  const key = apiKey();
  let done = 0;
  log.progress({ task: 'tts', done, total: todo.length, unit: 'clips' });
  try {
    await mapLimit(todo, cfg.concurrency, async (s: SegmentSpec) => {
      opts.signal?.throwIfAborted();
      const body: Record<string, unknown> = { model: cfg.model, input: s.text, response_format: 'pcm' };
      if (cfg.voice) body.voice = cfg.voice;
      const data = await synthesize(key, body, s.id, opts.signal);
      await writeFileAtomic(clipPath(project, s.id), data);
      clips[s.id] = { hash: clipHash(cfg.model, cfg.voice, s.text), dur: pcmDuration(data.length) };
      log.ok(`${s.id.padEnd(16)} ${clips[s.id]?.dur.toFixed(2)} s`);
      log.progress({ task: 'tts', done: ++done, total: todo.length, unit: 'clips' });
    });
  } catch (err) {
    // clips finished before a failure or a cancellation stay cached
    await save(project, clips);
    throw err;
  }
  return save(project, clips);
}

async function save(project: Project, clips: Record<string, VoiceClip>): Promise<VoiceManifest> {
  // keep the capsule's order for readable diffs
  const ordered: Record<string, VoiceClip> = {};
  for (const s of project.capsule.segments) {
    const c = clips[s.id];
    if (c) ordered[s.id] = c;
  }
  const manifest: VoiceManifest = {
    model: project.capsule.voice.model,
    voice: project.capsule.voice.voice ?? null,
    clips: ordered,
  };
  await writeFileAtomic(project.paths.voiceManifest, `${JSON.stringify(manifest, null, 1)}\n`);
  return manifest;
}

export interface VoiceSearchResult {
  readonly id: string;
  readonly title: string;
  readonly languages: readonly string[];
  readonly uses: number;
  readonly description: string;
}

/** Searches Fish Audio's public voice library (no key needed) for a fixed narrator voice. */
export async function searchVoices(lang: string, query: string, size = 20): Promise<VoiceSearchResult[]> {
  const q = new URLSearchParams({ page_size: String(size), language: lang, sort_by: 'task_count' });
  if (query) q.set('title', query);
  const res = await fetch(`https://api.fish.audio/model?${q}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Fish Audio search failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    items?: { _id: string; title: string; languages?: string[]; task_count?: number; description?: string }[];
  };
  return (data.items ?? []).map((m) => ({
    id: m._id,
    title: m.title,
    languages: m.languages ?? [],
    uses: m.task_count ?? 0,
    description: (m.description ?? '').replace(/\s+/g, ' ').slice(0, 90),
  }));
}
