/**
 * Applies a validated plan to the project's files, and undoes it. The plan is checked again
 * first (the capsule may have changed since the assistant answered), then every file is written.
 * What the files held before is saved in `.studio/assistant/undo/` first, so the change can be
 * undone from the same card, even after `studio ui` was restarted.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { log } from '../core/log.js';
import type { Project } from '../core/project.js';
import { writeFileAtomic } from '../core/util.js';
import type { StudioEdit } from './edits.js';
import { verify } from './check.js';

export interface PlanToApply {
  readonly edits: readonly StudioEdit[];
  readonly scenes: readonly { readonly id: string; readonly code: string }[];
}

export interface Applied {
  /** Key to undo this change (kept while `studio ui` runs). */
  readonly undo: string;
  /** Files written, relative to the project. */
  readonly files: readonly string[];
}

/** Files as they were before a change: path relative to the project → content (null: did not exist). */
type Snapshot = Record<string, string | null>;

const KEEP = 30;
const undoDir = (project: Project): string => path.join(project.paths.work, 'assistant', 'undo');
const undoFile = (project: Project, key: string): string => {
  if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error('clé d’annulation invalide');
  return path.join(undoDir(project), `${key}.json`);
};

export class PlanRejected extends Error {
  constructor(readonly errors: readonly string[]) {
    super(`la proposition ne passe plus les vérifications :\n${errors.map((e) => `- ${e}`).join('\n')}`);
  }
}

export async function applyPlan(project: Project, plan: PlanToApply): Promise<Applied> {
  const state = { edits: [...plan.edits], pending: [], scenes: new Map(plan.scenes.map((s) => [s.id, s.code])) };
  // types were checked before the card was shown; the bundle check is enough to catch a changed project
  const { errors, writes, plan: checked } = await verify(project, state, { types: false });
  // a checked plan applies as is; anything adjusted or left out now means the project changed meanwhile
  const changed =
    checked.warnings.length > 0 ||
    checked.edits.length !== plan.edits.length ||
    checked.scenes.length !== plan.scenes.length;
  if (errors.length || changed)
    throw new PlanRejected(errors.length ? errors : [...checked.warnings, 'le projet a changé depuis la proposition']);

  const before: Snapshot = {};
  for (const file of writes.keys())
    before[path.relative(project.paths.root, file)] = existsSync(file) ? await readFile(file, 'utf8') : null;
  const undo = randomUUID();
  // saved before anything is written: an interrupted application can still be undone
  await mkdir(undoDir(project), { recursive: true });
  await writeFileAtomic(undoFile(project, undo), JSON.stringify(before));
  await prune(project);
  // scenes and their registration before the capsule: a reload never sees a capsule without its scenes
  const ordered = [...writes].sort(
    ([a], [b]) => Number(a === project.paths.capsule) - Number(b === project.paths.capsule),
  );
  for (const [file, content] of ordered) await writeFileAtomic(file, content);

  const files = [...writes.keys()].map((f) => path.relative(project.paths.root, f));
  log.ok(`assistant : ${files.join(', ')} modifié${files.length > 1 ? 's' : ''}`);
  return { undo, files };
}

/** Puts back the files as they were before `applyPlan` (files it created are removed). */
export async function undoPlan(project: Project, undo: string): Promise<readonly string[]> {
  const file = undoFile(project, undo);
  if (!existsSync(file)) throw new Error('rien à annuler (déjà annulé, ou trop ancien)');
  const before = JSON.parse(await readFile(file, 'utf8')) as Snapshot;
  for (const [rel, content] of Object.entries(before)) {
    const target = path.resolve(project.paths.root, rel);
    if (!target.startsWith(project.paths.root + path.sep)) continue;
    if (content === null) await rm(target, { force: true });
    else await writeFileAtomic(target, content);
  }
  await rm(file, { force: true });
  const files = Object.keys(before);
  log.ok(`assistant : modification annulée (${files.join(', ')})`);
  return files;
}

/** Keeps the latest snapshots only. */
async function prune(project: Project): Promise<void> {
  const entries = await readdir(undoDir(project)).catch(() => []);
  const dated = await Promise.all(
    entries.map(async (name) => ({ name, mtime: (await stat(path.join(undoDir(project), name))).mtimeMs })),
  );
  dated.sort((a, b) => b.mtime - a.mtime);
  for (const { name } of dated.slice(KEEP)) await rm(path.join(undoDir(project), name), { force: true });
}
