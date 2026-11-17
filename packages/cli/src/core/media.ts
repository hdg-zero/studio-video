/**
 * Pictures and clips of the ready-made shots (`segments[].visual`), kept in the project's `media/`.
 *
 * Images are served as they are. Clips are cut into numbered JPEG frames at the capsule's frame
 * rate (ffmpeg, cached by content): the page then shows exactly frame n at time n / fps, in any
 * order, with no video decoder in the browser (headless Chromium has no H.264).
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Visual } from '@studio/runtime';
import type { Capsule, VisualSpec } from './config.js';
import type { Project } from './project.js';
import { resolveInside } from './server.js';
import { runOrThrow, sha256 } from './util.js';

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg'];
const VIDEO_EXT = ['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi'];
/** Longest part of a clip that is extracted (seconds). */
const MAX_CLIP = 120;

export interface MediaFile {
  readonly name: string;
  readonly kind: 'image' | 'video';
  readonly size: number;
}

export const mediaKind = (name: string): MediaFile['kind'] | null => {
  const ext = path.extname(name).toLowerCase();
  return IMAGE_EXT.includes(ext) ? 'image' : VIDEO_EXT.includes(ext) ? 'video' : null;
};

/** Files of `media/` usable in a shot, by name. */
export async function listMedia(project: Project): Promise<MediaFile[]> {
  if (!existsSync(project.paths.media)) return [];
  const out: MediaFile[] = [];
  for (const name of (await readdir(project.paths.media)).sort()) {
    const kind = mediaKind(name);
    if (!kind) continue;
    const st = await stat(path.join(project.paths.media, name));
    if (st.isFile()) out.push({ name, kind, size: st.size });
  }
  return out;
}

/** Absolute path of a file named in a shot (`media/` prefix tolerated), or null outside `media/`. */
function mediaPath(project: Project, src: string): string | null {
  return resolveInside(project.paths.media, src.replace(/^\.?\/?media\//, ''));
}

const fileHash = async (file: string): Promise<string> => sha256(await readFile(file));

export interface ResolvedVisuals {
  /** Shots as the page draws them, by segment id. */
  readonly visuals: Record<string, Visual>;
  /** What each shot's pixels depend on (description and file contents), for the render cache. */
  readonly fingerprints: ReadonlyMap<string, string>;
  /** Shots left out (missing file…), in words; only when `strict` is false. */
  readonly problems: readonly string[];
}

export interface ResolveOptions {
  /** Throw on a missing or unreadable file (renders) instead of leaving the shot out (previews). */
  readonly strict?: boolean;
}

/** Turns the capsule's shots into what the page draws, extracting clip frames when needed. */
export async function resolveVisuals(project: Project, opts: ResolveOptions = {}): Promise<ResolvedVisuals> {
  const { capsule } = project;
  const visuals: Record<string, Visual> = {};
  const fingerprints = new Map<string, string>();
  const problems: string[] = [];
  for (const seg of capsule.segments) {
    const v = seg.visual;
    if (!v) continue;
    try {
      const resolved = await resolveOne(project, capsule, v);
      visuals[seg.id] = resolved.visual;
      fingerprints.set(seg.id, sha256(JSON.stringify(v), resolved.content));
    } catch (err) {
      const message = `segment « ${seg.id} » : ${(err as Error).message}`;
      if (opts.strict) throw new Error(message, { cause: err });
      problems.push(message);
    }
  }
  return { visuals, fingerprints, problems };
}

async function resolveOne(
  project: Project,
  capsule: Capsule,
  v: VisualSpec,
): Promise<{ visual: Visual; content: string }> {
  if (v.type !== 'image' && v.type !== 'video') return { visual: v, content: '' };
  const file = mediaPath(project, v.src);
  if (!file || !existsSync(file)) throw new Error(`fichier media/${v.src} introuvable`);
  const content = await fileHash(file);
  const common = { fit: v.fit, dim: v.dim, caption: v.caption, credit: v.credit };
  if (v.type === 'image') {
    const rel = path.relative(project.paths.media, file).split(path.sep).map(encodeURIComponent).join('/');
    return {
      visual: {
        type: 'image',
        src: `media/${rel}?v=${content.slice(0, 8)}`,
        motion: v.motion,
        focus: v.focus,
        ...common,
      },
      content,
    };
  }
  const fps = capsule.format.fps;
  const { key, count } = await extractFrames(project, file, content, v.start, fps, capsule.format.width);
  return {
    visual: { type: 'video', frames: `frames/${key}`, count, fps, loop: v.loop, ...common },
    content: `${content}:${v.start}`,
  };
}

/** Cuts a clip into `.studio/frames/<key>/000001.jpg…` once; later calls reuse the frames. */
async function extractFrames(
  project: Project,
  file: string,
  content: string,
  start: number,
  fps: number,
  width: number,
): Promise<{ key: string; count: number }> {
  const key = sha256(content, String(start), String(fps), String(width)).slice(0, 24);
  const dir = path.join(project.paths.frames, key);
  const done = path.join(dir, 'frames.json');
  if (existsSync(done)) return { key, count: (JSON.parse(await readFile(done, 'utf8')) as { count: number }).count };

  const tmp = `${dir}.part`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  try {
    await runOrThrow('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      String(start),
      '-i',
      file,
      '-t',
      String(MAX_CLIP),
      '-an',
      '-vf',
      `fps=${fps},scale='min(${width},iw)':-2`,
      '-q:v',
      '3',
      path.join(tmp, '%06d.jpg'),
    ]);
  } catch (err) {
    await rm(tmp, { recursive: true, force: true });
    throw new Error(`clip ${path.basename(file)} illisible par ffmpeg : ${(err as Error).message}`, { cause: err });
  }
  const count = (await readdir(tmp)).filter((f) => f.endsWith('.jpg')).length;
  if (count === 0) {
    await rm(tmp, { recursive: true, force: true });
    throw new Error(`clip ${path.basename(file)} : aucune image après ${start} s`);
  }
  await writeFile(path.join(tmp, 'frames.json'), JSON.stringify({ count }));
  await rm(dir, { recursive: true, force: true });
  await rename(tmp, dir);
  return { key, count };
}

/** URL prefixes served next to the page: `media/` (pictures) and `frames/` (clip frames). */
export const mediaMounts = (project: Project): Record<string, string> => ({
  '/media/': project.paths.media,
  '/frames/': project.paths.frames,
});
