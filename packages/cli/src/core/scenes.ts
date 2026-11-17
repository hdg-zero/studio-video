/**
 * Scene files of a project: read, write, and register a new scene in `scenes/index.ts`
 * (one import plus one entry of `scenes: [...]`, in the order of the capsule's segments).
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from './project.js';

const SEGMENT_ID = /^[a-z0-9][a-z0-9_-]*$/;
const RESERVED = new Set(
  'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static await implements interface package private protected public THREE'.split(
    ' ',
  ),
);

const sceneFile = (project: Project, id: string): string => {
  if (!SEGMENT_ID.test(id)) throw new Error(`invalid segment id "${id}"`);
  return path.join(project.paths.scenes, `${id}.ts`);
};

export async function readScene(project: Project, id: string): Promise<string | null> {
  const file = sceneFile(project, id);
  return existsSync(file) ? readFile(file, 'utf8') : null;
}

/** `mon-segment` → `monSegment`, avoiding keywords and names already imported. */
export function identifierFor(id: string, taken: ReadonlySet<string> = new Set()): string {
  let name = id.replace(/[-_]+([a-z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/[-_]/g, '');
  if (/^\d/.test(name)) name = `s${name}`;
  if (RESERVED.has(name) || taken.has(name)) name = `${name}Scene`;
  return name;
}

export interface Registration {
  readonly source: string;
  readonly registered: boolean;
}

/**
 * Adds `id` to the source of `scenes/index.ts`. Returns the source unchanged (registered: false)
 * when the scene is already imported or when the file does not have the expected shape.
 */
export function registerScene(source: string, id: string, order: readonly string[]): Registration {
  const imports = [...source.matchAll(/^import\s+(\w+)\s+from\s+'\.\/([\w-]+)\.js';\s*$/gm)];
  if (imports.some((m) => m[2] === id)) return { source, registered: false };
  const array = /(scenes:\s*\[)([^\]]*)(\])/.exec(source);
  const last = imports.at(-1);
  if (!array || !last) return { source, registered: false };

  const idOf = new Map(imports.map((m) => [m[1] ?? '', m[2] ?? '']));
  const ident = identifierFor(id, new Set(idOf.keys()));
  const items = (array[2] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // after the closest preceding segment that has a scene; a scene that is not a segment goes
  // before the last one, which stays last (the engine shows the credits over the last scene)
  const at = order.indexOf(id);
  const anchor = order
    .slice(0, Math.max(0, at))
    .reverse()
    .map((seg) => items.findIndex((it) => idOf.get(it) === seg))
    .find((i) => i >= 0);
  items.splice(at < 0 ? Math.max(0, items.length - 1) : anchor === undefined ? 0 : anchor + 1, 0, ident);

  const lastEnd = last.index + last[0].length;
  let out = `${source.slice(0, lastEnd)}\nimport ${ident} from './${id}.js';${source.slice(lastEnd)}`;
  out = out.replace(/(scenes:\s*\[)([^\]]*)(\])/, `$1${items.join(', ')}$3`);
  return { source: out, registered: true };
}

/**
 * Files to write for new or changed scenes: each `scenes/<id>.ts`, plus `scenes/index.ts` when a
 * new scene must be registered there (`order` = segment ids in capsule order).
 */
export async function sceneWrites(
  project: Project,
  scenes: ReadonlyMap<string, string>,
  order: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let index = existsSync(project.paths.sceneEntry) ? await readFile(project.paths.sceneEntry, 'utf8') : null;
  let registered = false;
  for (const [id, code] of scenes) {
    out.set(sceneFile(project, id), code.endsWith('\n') ? code : `${code}\n`);
    if (index !== null) {
      const r = registerScene(index, id, order);
      index = r.source;
      registered ||= r.registered;
    }
  }
  if (registered && index !== null) out.set(project.paths.sceneEntry, index);
  return out;
}
