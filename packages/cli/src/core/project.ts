/**
 * A project is a folder holding `capsule.json` and `scenes/`.
 * Generated files live in `.studio/` (disposable cache) and `out/` (deliverables);
 * generated voice clips live in `voice/` because they cost API calls to recreate.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Timeline } from '@studio/runtime';
import { parseCapsule, type Capsule } from './config.js';

export interface ProjectPaths {
  readonly root: string;
  readonly capsule: string;
  readonly scenes: string;
  readonly sceneEntry: string;
  /** Pictures and clips used by ready-made shots. */
  readonly media: string;
  /** Frames extracted from the clips (cache). */
  readonly frames: string;
  /** Optional theme overrides appended after the runtime styles. */
  readonly styles: string;
  readonly voice: string;
  readonly voiceManifest: string;
  readonly work: string;
  readonly timeline: string;
  readonly audio: string;
  readonly mix: string;
  /** What the mix was made from (to tell whether it is up to date). */
  readonly mixInfo: string;
  readonly bundle: string;
  readonly chunks: string;
  readonly stills: string;
  readonly out: string;
}

export interface Project {
  readonly name: string;
  readonly paths: ProjectPaths;
  readonly capsule: Capsule;
}

export function projectPaths(root: string): ProjectPaths {
  const work = path.join(root, '.studio');
  const audio = path.join(work, 'audio');
  return {
    root,
    capsule: path.join(root, 'capsule.json'),
    scenes: path.join(root, 'scenes'),
    sceneEntry: path.join(root, 'scenes', 'index.ts'),
    media: path.join(root, 'media'),
    frames: path.join(work, 'frames'),
    styles: path.join(root, 'styles.css'),
    voice: path.join(root, 'voice'),
    voiceManifest: path.join(root, 'voice', 'manifest.json'),
    work,
    timeline: path.join(work, 'timeline.json'),
    audio,
    mix: path.join(audio, 'mix_norm.wav'),
    mixInfo: path.join(audio, 'mix.json'),
    bundle: path.join(work, 'bundle'),
    chunks: path.join(work, 'chunks'),
    stills: path.join(work, 'stills'),
    out: path.join(root, 'out'),
  };
}

/**
 * Resolves a project from a path or a bare name.
 * A bare name is looked up in `$STUDIO_PROJECTS`, then `./projects/`.
 */
function resolveProjectDir(ref: string, cwd = process.cwd()): string {
  const candidates = [path.resolve(cwd, ref)];
  if (!ref.includes('/')) {
    if (process.env.STUDIO_PROJECTS) candidates.push(path.resolve(process.env.STUDIO_PROJECTS, ref));
    candidates.push(path.resolve(cwd, 'projects', ref));
  }
  const found = candidates.find((c) => existsSync(path.join(c, 'capsule.json')));
  if (!found) throw new Error(`no capsule.json found for "${ref}" (looked in ${candidates.join(', ')})`);
  return found;
}

export async function loadProject(ref: string): Promise<Project> {
  const root = resolveProjectDir(ref);
  const paths = projectPaths(root);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(paths.capsule, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read ${paths.capsule}: ${(err as Error).message}`, { cause: err });
  }
  return { name: path.basename(root), paths, capsule: parseCapsule(raw, paths.capsule) };
}

export async function loadTimeline(project: Project): Promise<Timeline> {
  if (!existsSync(project.paths.timeline)) {
    throw new Error(`no timeline yet for ${project.name}: run \`studio timeline ${project.name}\` first`);
  }
  return JSON.parse(await readFile(project.paths.timeline, 'utf8')) as Timeline;
}

/** File-name friendly version of the title, e.g. "Le panoptique" → "Le_panoptique". */
export const outputName = (title: string): string =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'capsule';
