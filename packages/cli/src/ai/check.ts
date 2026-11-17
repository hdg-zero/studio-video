/**
 * Checks the assistant's proposals before the user is asked to validate them, so that what the
 * validation button applies is known to work:
 *
 *   capsule edits   → applied to capsule.json in memory, then validated by the capsule schema
 *   scene files     → right `defineScene('<id>', …)`, bundled by esbuild with the real project
 *                     (syntax, imports, missing exports), then type-checked (wrong API use)
 *
 * Errors are phrased for the model, which gets them back to correct its answer. The compilers
 * themselves are in compile.ts.
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { CapsuleSpec, MOODS } from '../core/config.js';
import { listMedia } from '../core/media.js';
import type { Project } from '../core/project.js';
import { readScene, sceneWrites } from '../core/scenes.js';
import type { BlockPart } from './blocks.js';
import { applyEdits, readEdits, type StudioEdit } from './edits.js';
import { applyPatch } from './patch.js';
import { compile, MAX_REPORT, typecheck } from './compile.js';
import { resolveEdits } from './normalize.js';

const Id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'identifiant : minuscules, chiffres, - et _');
const Text = z.string().max(5000);
const Mood = z.enum(MOODS);
/** Ready-made shot: checked in full by the capsule schema once applied. */
const Visual = z.record(z.string(), z.unknown());
const Segment = z.strictObject({
  id: Id,
  text: Text,
  mood: Mood.optional(),
  label: Text.optional(),
  key: Text.optional(),
  visual: Visual.optional(),
});
/** Edits as the studio sends them back to apply a plan (already resolved, see normalize.ts). */
export const EditSpec = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('update'),
    id: z.string(),
    fields: z
      .strictObject({ id: Id, mood: Mood, label: Text, key: Text, text: Text, visual: Visual.nullable() })
      .partial(),
  }),
  z.object({ op: z.literal('insert'), after: z.string().nullable(), segment: Segment }),
  z.object({ op: z.literal('remove'), id: z.string() }),
  z.object({ op: z.literal('move'), id: z.string(), after: z.string().nullable() }),
  z.object({ op: z.literal('set'), path: z.string(), value: z.unknown() }),
  z.object({ op: z.literal('replace'), segments: z.array(Segment).min(1).max(200) }),
]);

/**
 * What the assistant proposes so far. Edits that passed the checks are kept, the ones of a
 * correction are added to them; scene files of a correction replace the earlier ones.
 */
export interface ProposalState {
  /** Edits already checked (strict form). */
  edits: StudioEdit[];
  /** Edits of the latest answer, as the model wrote them. */
  pending: unknown[];
  readonly scenes: Map<string, string>;
}
export const emptyProposal = (): ProposalState => ({ edits: [], pending: [], scenes: new Map() });
export const hasProposal = (s: ProposalState): boolean => s.edits.length + s.pending.length + s.scenes.size > 0;

export interface PlannedScene {
  readonly id: string;
  readonly code: string;
  readonly created: boolean;
  readonly added: number;
  readonly removed: number;
}

/** A checked proposal, as shown on the validation card and sent back to apply it. */
export interface Plan {
  readonly edits: readonly StudioEdit[];
  readonly scenes: readonly PlannedScene[];
  /** What the studio fixed by itself (identifier, mood, position…). */
  readonly warnings: readonly string[];
  /** Parts left out because they still fail: the rest can be applied. */
  readonly dropped: readonly string[];
}

/** Adds an answer's blocks to the proposal; returns the problems found in the blocks themselves. */
export async function absorb(project: Project, state: ProposalState, blocks: readonly BlockPart[]): Promise<string[]> {
  const errors: string[] = [];
  for (const b of blocks) {
    const name = b.kind === 'edits' ? 'studio-edits' : `${b.kind === 'scene' ? 'scene' : 'scene-patch'}:${b.id}`;
    try {
      if (b.kind === 'edits') {
        // a cut block still yields its complete edits (the JSON repair closes the brackets)
        state.pending.push(...readEdits(b.body));
        if (!b.complete)
          errors.push(`bloc ${name} coupé : renvoyer les opérations qui manquent après la dernière reçue`);
        continue;
      }
      if (!b.complete) {
        errors.push(`bloc ${name} incomplet (réponse coupée) : le renvoyer en entier`);
        continue;
      }
      const id = Id.parse(b.id);
      if (b.kind === 'scene') state.scenes.set(id, b.code);
      else {
        const base = state.scenes.get(id) ?? (await readScene(project, id));
        if (base === null)
          throw new Error(`scenes/${id}.ts n'existe pas : envoyer le fichier complet (bloc scene:${id})`);
        state.scenes.set(id, applyPatch(base, b.body));
      }
    } catch (err) {
      errors.push(`bloc ${name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return errors;
}

export interface Verified {
  /** The parts that pass (possibly all of them). */
  readonly plan: Plan;
  /** Why the other parts fail, phrased for the model. */
  readonly errors: readonly string[];
  /** Absolute path → new content, for every file the plan changes. */
  readonly writes: ReadonlyMap<string, string>;
}

export const planIsEmpty = (p: Plan): boolean => p.edits.length === 0 && p.scenes.length === 0;

/**
 * Checks a proposal against the project as it is on disk now. Each edit and each scene is judged
 * on its own: the plan holds the ones that pass, `errors` says why the others do not.
 * `state.edits` becomes the edits that pass, so a correction only has to add the missing ones.
 */
export async function verify(
  project: Project,
  state: ProposalState,
  opts: { types?: boolean } = {},
): Promise<Verified> {
  const raw = JSON.parse(await readFile(project.paths.capsule, 'utf8')) as Record<string, unknown>;
  const resolved = resolveEdits(raw, [...state.edits, ...state.pending]);
  const errors = [...resolved.errors];
  let edits = resolved.edits;
  let capsule = resolved.capsule;
  // an edit that makes the capsule invalid (a colour, an empty title) is left out with its reason
  for (let tries = 0; edits.length > 0 && tries < 5; tries++) {
    const r = CapsuleSpec.safeParse(capsule);
    if (r.success) break;
    const issue = r.error.issues[0];
    if (!issue) break;
    const culprit = culpritOf(edits, capsule, issue.path);
    errors.push(describeIssue(capsule, issue.path, issue.message));
    // a bad shot only costs the shot: the segment's text is kept
    const shotOf = issue.path[2] === 'visual' ? segmentIdAt(capsule, issue.path[1]) : null;
    edits = culprit === -1 ? [] : shotOf ? withoutShot(edits, culprit, shotOf) : edits.filter((_, i) => i !== culprit);
    capsule = applyEdits(raw, edits);
  }
  // pictures and clips must exist in media/ (the model only sees their names)
  const media = await listMedia(project);
  for (const [n, seg] of (Array.isArray(capsule.segments)
    ? (capsule.segments as Record<string, unknown>[])
    : []
  ).entries()) {
    const v = seg.visual as { type?: unknown; src?: unknown } | undefined;
    if (!v || (v.type !== 'image' && v.type !== 'video') || typeof v.src !== 'string') continue;
    if (media.some((m) => m.name === v.src && m.kind === v.type)) continue;
    const id = String(seg.id);
    const before = (raw.segments as Record<string, unknown>[] | undefined)?.find((x) => x.id === id)?.visual;
    if (JSON.stringify(before) === JSON.stringify(v)) continue; // already there: not this proposal's doing
    const culprit = culpritOf(edits, capsule, ['segments', n, 'visual']);
    if (culprit === -1) continue;
    const offer = media.filter((m) => m.kind === v.type).map((m) => m.name);
    errors.push(
      `segment « ${id} », visual.src : media/${v.src} n'existe pas (${offer.length ? `fichiers ${v.type === 'image' ? 'image' : 'vidéo'} : ${offer.join(', ')}` : `aucun fichier ${v.type === 'image' ? 'image' : 'vidéo'} : choisir un autre type de plan`})`,
    );
    edits = withoutShot(edits, culprit, id);
    capsule = applyEdits(raw, edits);
  }
  state.edits = edits;
  state.pending = [];

  const order = (Array.isArray(capsule.segments) ? (capsule.segments as { id?: unknown }[]) : []).map((s) =>
    String(s.id),
  );
  const sceneErrors = new Map<string, string[]>();
  const fail = (id: string, message: string): void => {
    sceneErrors.set(id, [...(sceneErrors.get(id) ?? []), message]);
  };
  for (const [id, code] of state.scenes) {
    if (!order.includes(id)) fail(id, `scenes/${id}.ts : aucun segment « ${id} » dans la capsule`);
    const declared = /defineScene\(\s*(['"`])([^'"`]+)\1/.exec(code)?.[2];
    if (declared === undefined) fail(id, `scenes/${id}.ts : doit faire « export default defineScene('${id}', …) »`);
    else if (declared !== id) fail(id, `scenes/${id}.ts : defineScene('${declared}') au lieu de defineScene('${id}')`);
  }
  const passing = (): Map<string, string> => new Map([...state.scenes].filter(([id]) => !sceneErrors.has(id)));

  if (passing().size > 0) {
    // compile until what remains compiles: an error in one file must not condemn the others
    for (let tries = 0; passing().size > 0 && tries < 3; tries++) {
      const failures = await compile(project, await sceneWrites(project, passing(), order));
      if (failures.length === 0) break;
      for (const f of failures) for (const id of blame(f.file, passing())) fail(id, f.message);
    }
    if (passing().size > 0 && opts.types !== false)
      for (const f of await typecheck(project, await sceneWrites(project, passing(), order)))
        for (const id of blame(f.file, passing())) fail(id, f.message);
  }
  for (const list of sceneErrors.values()) errors.push(...list.slice(0, MAX_REPORT));

  const valid = passing();
  const writes = await sceneWrites(project, valid, order);
  if (edits.length) writes.set(project.paths.capsule, `${JSON.stringify(capsule, null, 2)}\n`);
  const scenes: PlannedScene[] = [];
  for (const [id, code] of valid) {
    const before = await readScene(project, id).catch(() => null);
    scenes.push({ id, code, created: before === null, ...lineDiff(before ?? '', code) });
  }
  const dropped = [...sceneErrors.keys()].map((id) => `scène « ${id} »`);
  return { plan: { edits, scenes, warnings: resolved.warnings, dropped }, errors, writes };
}

const segmentIdAt = (capsule: Record<string, unknown>, index: PropertyKey | undefined): string | null => {
  const id = typeof index === 'number' ? (capsule.segments as { id?: unknown }[])[index]?.id : undefined;
  return typeof id === 'string' ? id : null;
};

/** The edits with the shot of segment `id` taken out of edit `n` (dropped if nothing else remains). */
function withoutShot(edits: readonly StudioEdit[], n: number, id: string): StudioEdit[] {
  const strip = <T extends { id: string; visual?: unknown }>(seg: T): T => {
    if (seg.id !== id) return seg;
    const copy = { ...seg };
    delete copy.visual;
    return copy;
  };
  return edits.flatMap((e, i): StudioEdit[] => {
    if (i !== n) return [e];
    switch (e.op) {
      case 'update': {
        const fields = { ...e.fields };
        delete fields.visual;
        return Object.keys(fields).length ? [{ ...e, fields }] : [];
      }
      case 'insert':
        return [{ ...e, segment: strip(e.segment) }];
      case 'replace':
        return [{ ...e, segments: e.segments.map(strip) }];
      default:
        return [];
    }
  });
}

/** The scene ids an error in `file` concerns (a shared file or none: all of them). */
function blame(file: string | null, scenes: ReadonlyMap<string, string>): string[] {
  const id = file && /scenes\/([\w-]+)\.ts$/.exec(file)?.[1];
  return id && scenes.has(id) ? [id] : [...scenes.keys()];
}

/** Index of the edit responsible for a schema issue (-1: none found, drop them all). */
function culpritOf(edits: readonly StudioEdit[], capsule: Record<string, unknown>, at: readonly PropertyKey[]): number {
  let target: string | null = null;
  if (at[0] === 'segments' && typeof at[1] === 'number') {
    const id = (capsule.segments as { id?: unknown }[])[at[1]]?.id;
    target = typeof id === 'string' ? id : null;
  }
  const dotted = at.join('.');
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    if (!e) continue;
    if (e.op === 'set' && dotted.startsWith(e.path)) return i;
    if (target === null) continue;
    if (e.op === 'update' && (e.id === target || e.fields.id === target)) return i;
    if (e.op === 'insert' && e.segment.id === target) return i;
    if (e.op === 'replace' && e.segments.some((s) => s.id === target)) return i;
  }
  return -1;
}

/** `segments.3.text` → `segment « idee » (n° 4), text : …` */
function describeIssue(capsule: Record<string, unknown>, at: readonly PropertyKey[], message: string): string {
  if (at[0] === 'segments' && typeof at[1] === 'number') {
    const id = (capsule.segments as { id?: unknown }[])[at[1]]?.id;
    const field = at.slice(2).join('.');
    return `segment « ${typeof id === 'string' ? id : '?'} » (n° ${at[1] + 1})${field ? `, ${field}` : ''} : ${message}`;
  }
  return `${at.join('.') || 'capsule'} : ${message}`;
}

function lineDiff(before: string, after: string): { added: number; removed: number } {
  const count = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const l of s.split('\n')) if (l.trim()) m.set(l.trim(), (m.get(l.trim()) ?? 0) + 1);
    return m;
  };
  const a = count(before);
  const b = count(after);
  let added = 0;
  let removed = 0;
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) ?? 0));
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) ?? 0));
  return { added, removed };
}
