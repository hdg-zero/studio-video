/**
 * Vertical short videos made from an existing capsule: `studio short <project> --segments a,b,c`
 * writes a new project with the chosen segments, framed 9:16, with short timings. The voice clips
 * of those segments are copied with their manifest entries: same model, voice and text give the
 * same hash, so the short needs no new voice generation.
 */
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SHORT_TIMING, VERTICAL_FORMAT, type Capsule } from './config.js';
import { STUDIO_HOME } from './home.js';
import { clipPath, readManifest, type VoiceManifest } from './tts.js';
import { buildTimeline, estimateDuration } from './timeline.js';
import { PROJECT_NAME } from './scaffold.js';
import type { Project } from './project.js';

/** Beyond this, some apps stop treating a video as a short one: the command warns. */
export const SHORT_MAX_SECONDS = 60;

export interface ShortPlan {
  /** The new capsule.json, as written (fields of the source kept, unknown ones included). */
  readonly capsule: Record<string, unknown>;
  /** Estimated length of the short in seconds (voice durations when known, else reading time). */
  readonly duration: number;
  /** Segments whose duration is an estimate (no voice clip yet). */
  readonly estimated: readonly string[];
}

/**
 * Builds the short's capsule from the source's raw JSON (kept as written) and its parsed form.
 * `segments` keeps the given order; durations come from the voice manifest when present.
 */
export function planShort(
  raw: Record<string, unknown>,
  capsule: Capsule,
  segments: readonly string[],
  durations: Readonly<Record<string, number>>,
  title?: string,
): ShortPlan {
  if (!segments.length) throw new Error('choose at least one segment (--segments a,b,c)');
  const byId = new Map(capsule.segments.map((s) => [s.id, s]));
  const unknown = segments.filter((id) => !byId.has(id));
  if (unknown.length)
    throw new Error(`unknown segment(s): ${unknown.join(', ')} (available: ${[...byId.keys()].join(', ')})`);
  const twice = segments.filter((id, i) => segments.indexOf(id) !== i);
  if (twice.length) throw new Error(`segment(s) chosen twice: ${[...new Set(twice)].join(', ')}`);

  const rawSegments = (raw.segments as Record<string, unknown>[] | undefined) ?? [];
  const rawById = new Map(rawSegments.map((s) => [s.id as string, s]));
  const rawFormat = (raw.format as Record<string, unknown> | undefined) ?? {};
  const rawTiming = (raw.timing as Record<string, unknown> | undefined) ?? {};
  const out: Record<string, unknown> = {
    ...raw,
    title: title ?? capsule.title,
    format: { ...rawFormat, ...VERTICAL_FORMAT, fps: capsule.format.fps },
    timing: { ...rawTiming, ...SHORT_TIMING },
    segments: segments.map((id) => rawById.get(id) ?? byId.get(id)),
  };
  if (title && typeof out.credits === 'string') out.credits = out.credits.replace(capsule.title, title);

  const estimated: string[] = [];
  const timed = segments.map((id) => {
    const s = byId.get(id) as Capsule['segments'][number];
    const known = durations[id];
    if (known === undefined) estimated.push(id);
    return { ...s, dur: known ?? estimateDuration(s.text, capsule.timing.readingSpeed) };
  });
  const { duration } = buildTimeline(timed, { ...capsule.timing, ...SHORT_TIMING });
  return { capsule: out, duration, estimated };
}

/** Voice durations of a project, by segment id, for the clips that match the current text. */
export function knownDurations(capsule: Capsule, manifest: VoiceManifest | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of capsule.segments) {
    const clip = manifest?.clips[s.id];
    if (clip) out[s.id] = clip.dur;
  }
  return out;
}

export interface ShortResult extends ShortPlan {
  readonly name: string;
  readonly root: string;
  /** Voice clips copied (the others must be generated with `studio tts`). */
  readonly voices: readonly string[];
}

/** Writes the short as a new project next to the source (or in `dir`). */
export async function createShort(
  source: Project,
  segments: readonly string[],
  opts: { readonly name?: string; readonly title?: string; readonly dir?: string } = {},
): Promise<ShortResult> {
  const name = opts.name ?? `${source.name}-court`;
  if (!PROJECT_NAME.test(name)) throw new Error('project names use lowercase letters, digits, - and _');
  const dest = path.join(path.resolve(opts.dir ?? path.dirname(source.paths.root)), name);
  if (existsSync(dest)) throw new Error(`${dest} already exists (choose another --name)`);

  const raw = JSON.parse(await readFile(source.paths.capsule, 'utf8')) as Record<string, unknown>;
  const manifest = await readManifest(source);
  const plan = planShort(raw, source.capsule, segments, knownDurations(source.capsule, manifest), opts.title);

  // everything the scenes may import or load (scenes/, media/, tools/, README…), never caches,
  // renders or the voice folder: only the chosen clips are copied below
  await mkdir(dest, { recursive: true });
  const skip = new Set(['.studio', 'out', 'voice', 'capsule.json', 'node_modules']);
  for (const entry of await readdir(source.paths.root)) {
    if (skip.has(entry)) continue;
    await cp(path.join(source.paths.root, entry), path.join(dest, entry), { recursive: true });
  }
  if (typeof plan.capsule.$schema === 'string')
    plan.capsule.$schema = path.relative(dest, path.join(STUDIO_HOME, 'schemas', 'capsule.schema.json'));
  await writeFile(path.join(dest, 'capsule.json'), `${JSON.stringify(plan.capsule, null, 2)}\n`);

  const voices: string[] = [];
  if (manifest) {
    const clips: VoiceManifest['clips'] = {};
    const voiceDir = path.join(dest, path.relative(source.paths.root, source.paths.voice));
    await mkdir(voiceDir, { recursive: true });
    for (const id of segments) {
      const clip = manifest.clips[id];
      const file = clipPath(source, id);
      if (!clip || !existsSync(file)) continue;
      await cp(file, path.join(voiceDir, path.basename(file)));
      clips[id] = clip;
      voices.push(id);
    }
    const manifestFile = path.join(dest, path.relative(source.paths.root, source.paths.voiceManifest));
    await writeFile(manifestFile, `${JSON.stringify({ ...manifest, clips }, null, 1)}\n`);
  }
  return { ...plan, name, root: dest, voices };
}
