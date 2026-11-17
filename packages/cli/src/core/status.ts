/**
 * Where a project stands: which steps are done, which are stale, and what to run next.
 * Shared by `studio status` (humans and agents, `--json`) and the web UI.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { mixInputs, type MixInfo } from './audio.js';
import { STUDIO_HOME } from './home.js';
import { loadProject, outputName, type Project } from './project.js';
import { computeTimeline } from './steps.js';
import { apiKeyAvailable, clipHash, clipPath, readManifest } from './tts.js';

/** `fresh`: up to date · `stale`: exists but its inputs changed · `missing`: never produced. */
export type Freshness = 'fresh' | 'stale' | 'missing';

export interface SegmentStatus {
  readonly id: string;
  readonly mood: string;
  readonly label: string;
  readonly chars: number;
  readonly voice: Freshness;
  /** Voice duration (s): measured when the clip is fresh, else estimated from the text. */
  readonly dur: number;
  /** Segment start and end in the current timeline file, when there is one. */
  readonly t0: number | null;
  readonly t1: number | null;
  /** `scenes/<id>.ts` exists (one file per scene keeps the render cache precise). */
  readonly scene: boolean;
}

export interface StepStatus {
  readonly state: Freshness;
  readonly file: string;
  readonly mtime: number | null;
}

export interface RenderFile {
  readonly file: string;
  readonly name: string;
  readonly size: number;
  readonly mtime: number;
  readonly draft: boolean;
  /** Older than the timeline, the mix, the capsule or a scene file. */
  readonly stale: boolean;
}

export interface NextStep {
  readonly command: string;
  readonly reason: string;
}

export interface ProjectStatus {
  readonly name: string;
  readonly title: string;
  readonly root: string;
  readonly fps: number;
  /** Duration of the timeline the capsule produces now (s). */
  readonly duration: number;
  readonly segments: readonly SegmentStatus[];
  readonly voice: Freshness;
  readonly timeline: StepStatus;
  readonly music: StepStatus & { readonly withVoice: boolean };
  readonly stills: StepStatus;
  readonly renders: readonly RenderFile[];
  /** File names (in out/) of the full final render and of the full draft. */
  readonly outputs: { readonly final: string; readonly draft: string };
  readonly cache: { readonly chunks: number; readonly bytes: number };
  readonly apiKey: boolean;
  /** The command that moves the project forward, or null when the final video is up to date. */
  readonly next: NextStep | null;
}

const mtimeOf = async (file: string): Promise<number | null> => {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
};

async function newestIn(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const times = await Promise.all(
    entries.filter((e) => e.isFile()).map((e) => mtimeOf(path.join(e.parentPath, e.name))),
  );
  return Math.max(0, ...times.map((t) => t ?? 0));
}

async function dirUsage(dir: string): Promise<{ chunks: number; bytes: number }> {
  if (!existsSync(dir)) return { chunks: 0, bytes: 0 };
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.mp4'));
  const sizes = await Promise.all(files.map(async (e) => (await stat(path.join(e.parentPath, e.name))).size));
  return { chunks: files.length, bytes: sizes.reduce((a, b) => a + b, 0) };
}

const worst = (states: readonly Freshness[]): Freshness =>
  states.includes('missing') ? 'missing' : states.includes('stale') ? 'stale' : 'fresh';

export async function projectStatus(project: Project): Promise<ProjectStatus> {
  const { capsule, paths, name } = project;
  const manifest = await readManifest(project);
  const { timeline: expected, estimated } = await computeTimeline(project);

  const voiceOf = (id: string, text: string): Freshness => {
    const clip = manifest?.clips[id];
    if (!clip || !existsSync(clipPath(project, id))) return 'missing';
    return clip.hash === clipHash(capsule.voice.model, capsule.voice.voice, text) ? 'fresh' : 'stale';
  };

  // timeline: up to date when the file equals what the capsule and clips produce now
  const timelineText = existsSync(paths.timeline) ? await readFile(paths.timeline, 'utf8') : null;
  const onDisk = timelineText === null ? null : (JSON.parse(timelineText) as typeof expected);
  const timelineState: Freshness =
    onDisk === null ? 'missing' : JSON.stringify(onDisk) === JSON.stringify(expected) ? 'fresh' : 'stale';

  const segments: SegmentStatus[] = capsule.segments.map((s) => {
    const placed = onDisk?.segments.find((x) => x.id === s.id);
    const planned = expected.segments.find((x) => x.id === s.id);
    return {
      id: s.id,
      mood: s.mood,
      label: s.label,
      chars: s.text.length,
      voice: voiceOf(s.id, s.text),
      dur: planned?.dur ?? 0,
      t0: placed?.t0 ?? null,
      t1: placed?.t1 ?? null,
      scene: existsSync(path.join(paths.scenes, `${s.id}.ts`)),
    };
  });
  const voice = worst(segments.map((s) => s.voice));

  // music: up to date when its recorded inputs match, and it has the voice once the voice exists
  const mixTime = await mtimeOf(paths.mix);
  let musicState: Freshness = 'missing';
  let withVoice = false;
  if (mixTime !== null) {
    const info = existsSync(paths.mixInfo) ? (JSON.parse(await readFile(paths.mixInfo, 'utf8')) as MixInfo) : null;
    withVoice = info ? !info.noVoice : false;
    const voiceAvailable = estimated.length < capsule.segments.length;
    musicState =
      info?.inputs === (await mixInputs(project)) && (withVoice || !voiceAvailable) && timelineState === 'fresh'
        ? 'fresh'
        : 'stale';
  }

  // pictures depend on the capsule, the timeline and the scene code
  const pictureInputs = Math.max(
    (await mtimeOf(paths.capsule)) ?? 0,
    (await mtimeOf(paths.timeline)) ?? 0,
    await newestIn(paths.scenes),
    (await mtimeOf(paths.styles)) ?? 0,
  );
  const sheet = path.join(paths.work, 'contact_sheet.png');
  const sheetTime = await mtimeOf(sheet);
  const stillsState: Freshness =
    sheetTime === null ? 'missing' : sheetTime >= pictureInputs && timelineState === 'fresh' ? 'fresh' : 'stale';

  const renders: RenderFile[] = [];
  if (existsSync(paths.out)) {
    for (const f of (await readdir(paths.out)).filter((n) => n.endsWith('.mp4')).sort()) {
      const file = path.join(paths.out, f);
      const st = await stat(file);
      const inputs = Math.max(pictureInputs, mixTime ?? 0);
      renders.push({
        file,
        name: f,
        size: st.size,
        mtime: st.mtimeMs,
        draft: f.includes('_brouillon'),
        stale: st.mtimeMs < inputs || timelineState !== 'fresh',
      });
    }
  }

  const apiKey = apiKeyAvailable();
  const status = {
    name,
    title: capsule.title,
    root: paths.root,
    fps: capsule.format.fps,
    duration: expected.duration,
    segments,
    voice,
    timeline: { state: timelineState, file: paths.timeline, mtime: await mtimeOf(paths.timeline) },
    music: { state: musicState, file: paths.mix, mtime: mixTime, withVoice },
    stills: { state: stillsState, file: sheet, mtime: sheetTime },
    renders,
    outputs: { final: `${outputName(capsule.title)}.mp4`, draft: `${outputName(capsule.title)}_brouillon.mp4` },
    cache: await dirUsage(paths.chunks),
    apiKey,
  };
  return { ...status, next: nextStep(status) };
}

/** The next command to run, in pipeline order. */
export function nextStep(s: Omit<ProjectStatus, 'next'>): NextStep | null {
  const n = s.name;
  if (s.voice !== 'fresh' && s.apiKey)
    return { command: `studio tts ${n}`, reason: 'voix off manquante ou texte modifié' };
  if (s.timeline.state !== 'fresh')
    return {
      command: s.voice === 'fresh' ? `studio timeline ${n}` : `studio timeline ${n} --estimate`,
      reason:
        s.voice === 'fresh'
          ? 'timeline absente ou périmée'
          : 'timeline absente ou périmée (durées estimées : pas de clé OpenRouter)',
    };
  if (s.music.state !== 'fresh')
    return {
      command: s.voice === 'missing' && !s.music.withVoice ? `studio music ${n} --no-voice` : `studio music ${n}`,
      reason: 'musique absente ou périmée',
    };
  if (s.stills.state !== 'fresh')
    return { command: `studio stills ${n}`, reason: 'vérifier le cadrage sur la planche contact' };
  const final = s.renders.find((r) => r.name === s.outputs.final);
  if (!final || final.stale) {
    const draft = s.renders.find((r) => r.name === s.outputs.draft);
    return !draft || draft.stale
      ? { command: `studio render ${n} --draft`, reason: 'brouillon 720p pour valider le rythme' }
      : { command: `studio render ${n}`, reason: 'rendu final 1080p' };
  }
  return null;
}

export interface ProjectSummary {
  readonly name: string;
  readonly title: string;
  readonly root: string;
  readonly segments: number;
  readonly mtime: number;
  /** Set when capsule.json does not parse or validate. */
  readonly error?: string;
}

/** Folder holding the projects: `$STUDIO_PROJECTS`, else `<studio>/projects`. */
export const projectsRoot = (): string =>
  path.resolve(process.env.STUDIO_PROJECTS ?? path.join(STUDIO_HOME, 'projects'));

export async function listProjects(root = projectsRoot()): Promise<ProjectSummary[]> {
  if (!existsSync(root)) return [];
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && existsSync(path.join(root, d.name, 'capsule.json')))
    .map((d) => d.name)
    .sort();
  return Promise.all(
    dirs.map(async (name): Promise<ProjectSummary> => {
      const dir = path.join(root, name);
      const mtime = Math.max(
        (await mtimeOf(path.join(dir, 'capsule.json'))) ?? 0,
        (await mtimeOf(path.join(dir, 'out'))) ?? 0,
      );
      try {
        const p = await loadProject(dir);
        return { name, title: p.capsule.title, root: dir, segments: p.capsule.segments.length, mtime };
      } catch (err) {
        return { name, title: name, root: dir, segments: 0, mtime, error: (err as Error).message };
      }
    }),
  );
}
