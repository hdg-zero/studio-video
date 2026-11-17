/**
 * Turns the edits a model wrote into edits the studio can apply, fixing what has an obvious
 * meaning instead of rejecting it, one edit at a time:
 *
 *   op names       add → insert, delete → remove, edit → update, rewrite/narration → replace
 *   shapes         fields given at the top level, `segment` missing, `after` missing
 *   identifiers    « Mon Segment » → mon-segment, duplicates numbered, `credits` avoided
 *   moods          French names (« montée »), unknown ones → calm
 *   conflicts      insert of an existing id → update; remove of a missing id → ignored
 *
 * What cannot be fixed is reported per edit, and only that edit is left out: one bad line no
 * longer loses a whole narration. The result lists the edits as applied (`after` resolved), so
 * applying them again later gives exactly what was checked.
 */
import { CREDITS_ID, MOODS, type Mood } from '../core/config.js';
import { applyEdits, SETTABLE, type SegmentInput, type StudioEdit } from './edits.js';

type Capsule = Record<string, unknown>;

export interface Resolved {
  readonly capsule: Capsule;
  /** The edits that apply, in a strict form. */
  readonly edits: StudioEdit[];
  /** Fixed silently, shown to the user. */
  readonly warnings: string[];
  /** Edits left out, phrased for the model. */
  readonly errors: string[];
}

const OPS: Record<string, StudioEdit['op']> = {
  update: 'update',
  edit: 'update',
  modify: 'update',
  change: 'update',
  rewrite: 'update',
  insert: 'insert',
  add: 'insert',
  create: 'insert',
  append: 'insert',
  new: 'insert',
  remove: 'remove',
  delete: 'remove',
  del: 'remove',
  drop: 'remove',
  move: 'move',
  reorder: 'move',
  set: 'set',
  replace: 'replace',
  replaceall: 'replace',
  replacesegments: 'replace',
  setsegments: 'replace',
  narration: 'replace',
};

const MOOD_NAMES: Record<string, Mood> = {
  ouverture: 'intro',
  introduction: 'intro',
  calme: 'calm',
  pose: 'calm',
  pulsation: 'pulse',
  rythme: 'pulse',
  montee: 'build',
  crescendo: 'build',
  choc: 'explosion',
  impact: 'explosion',
  tension: 'suspense',
  mystere: 'suspense',
  lumineux: 'bright',
  espoir: 'bright',
  sombre: 'dark',
  grave: 'dark',
  depouille: 'minimal',
  epure: 'minimal',
  final: 'finale',
  conclusion: 'finale',
  fin: 'finale',
};

/** Any JSON value as text (objects as JSON rather than « [object Object] »). */
const str = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : v === undefined
        ? ''
        : JSON.stringify(v);

const SHOT_TYPES: Record<string, string> = {
  image: 'image',
  photo: 'image',
  picture: 'image',
  video: 'video',
  clip: 'video',
  title: 'title',
  titre: 'title',
  quote: 'quote',
  citation: 'quote',
  stat: 'stat',
  chiffre: 'stat',
  nombre: 'stat',
  number: 'stat',
  figure: 'stat',
  list: 'list',
  liste: 'list',
  bullets: 'list',
  chart: 'chart',
  graph: 'chart',
  graphique: 'chart',
  dates: 'dates',
  frise: 'dates',
  timeline: 'dates',
};

const plain = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Any string → a valid segment id (lowercase, digits, - and _). */
const slug = (s: string): string =>
  plain(s)
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 48);

function moodOf(value: unknown, warn: (m: string) => void, where: string): Mood {
  if (value === undefined || value === null || value === '') return 'calm';
  const name = plain(str(value));
  if ((MOODS as readonly string[]).includes(name)) return name as Mood;
  const known = MOOD_NAMES[name];
  if (known) return known;
  warn(`${where} : ambiance « ${str(value)} » inconnue, « calm » à la place`);
  return 'calm';
}

const text = (v: unknown): string | undefined =>
  v === undefined || v === null ? undefined : typeof v === 'string' ? v.trim() : str(v);

/**
 * A ready-made shot as the model wrote it → the capsule's form: type names in French or English,
 * `media/` prefix, numbers written as text, chart data as `{"label": value}`. null = remove.
 */
function shotFrom(value: unknown, where: string): Record<string, unknown> | null {
  if (value === null || value === 'none' || value === 'scene' || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${where} : "visual" doit être un objet, ex. {"type": "title", "text": "…"}`);
  const o = { ...(value as Record<string, unknown>) };
  const type = SHOT_TYPES[plain(str(o.type ?? o.kind ?? ''))];
  if (!type)
    throw new Error(
      `${where} : type de plan « ${str(o.type)} » inconnu (image, video, title, quote, stat, list, chart, dates)`,
    );
  if (o.kind !== undefined && o.type === undefined) delete o.kind;
  o.type = type;
  if (typeof o.src === 'string') o.src = o.src.replace(/^\.?\/?media\//, '');
  const toNumber = (v: unknown): unknown =>
    typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(/[\s  ]/g, '').replace(',', '.')))
      ? Number(v.replace(/[\s  ]/g, '').replace(',', '.'))
      : v;
  for (const k of ['value', 'decimals', 'start', 'dim']) if (k in o) o[k] = toNumber(o[k]);
  if (type === 'chart' && o.data && typeof o.data === 'object' && !Array.isArray(o.data))
    o.data = Object.entries(o.data as Record<string, unknown>).map(([label, v]) => ({ label, value: v }));
  if (type === 'chart' && Array.isArray(o.data))
    o.data = (o.data as unknown[]).map((d) =>
      d && typeof d === 'object' ? { ...d, value: toNumber((d as Record<string, unknown>).value) } : d,
    );
  if (type === 'list' && typeof o.items === 'string') o.items = o.items.split('\n').filter((l) => l.trim());
  if (type === 'dates' && !o.events && Array.isArray(o.items)) o.events = o.items;
  return o;
}

/** Applies the model's edits one by one to the capsule, fixing or leaving out each one. */
export function resolveEdits(capsule: Capsule, raw: readonly unknown[]): Resolved {
  const warnings: string[] = [];
  const errors: string[] = [];
  const edits: StudioEdit[] = [];
  let current = capsule;
  const ids = (): string[] =>
    Array.isArray(current.segments) ? (current.segments as { id?: unknown }[]).map((s) => String(s.id)) : [];
  /** Where an insert without `after` goes: after the previous insert of this block, else at the end. */
  let lastInserted: string | null = null;

  const findId = (value: unknown): string | null => {
    const want = text(value);
    if (!want) return null;
    const list = ids();
    return list.includes(want) ? want : (list.find((id) => id === slug(want)) ?? null);
  };
  const freshId = (wanted: string, segmentText: string, taken: Set<string>): string => {
    let id = slug(wanted) || slug(segmentText.split(/\s+/).slice(0, 3).join(' ')) || 'segment';
    if (id === CREDITS_ID) id = `${CREDITS_ID}-2`;
    if (!/^[a-z0-9]/.test(id)) id = `s${id}`;
    let n = 2;
    const base = id;
    while (taken.has(id)) id = `${base}-${n++}`;
    taken.add(id);
    return id;
  };
  const segmentFrom = (
    o: Record<string, unknown>,
    where: string,
    taken: Set<string>,
    warn: (m: string) => void,
  ): SegmentInput => {
    const t = text(o.text ?? o.texte ?? o.narration ?? o.voice);
    if (!t) throw new Error(`${where} : texte manquant`);
    const wanted = text(o.id) ?? '';
    const id = freshId(wanted, t, taken);
    if (wanted && id !== wanted) warn(`${where} : identifiant « ${wanted} » devenu « ${id} »`);
    const key = text(o.key ?? o.title ?? o.titre);
    const label = text(o.label ?? o.chapter ?? o.chapitre);
    const shot = o.visual ?? o.plan;
    const visual = shot === undefined ? null : shotFrom(shot, where);
    return {
      id,
      text: t,
      mood: moodOf(o.mood ?? o.ambiance, warn, where),
      ...(key !== undefined ? { key } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(visual ? { visual } : {}),
    };
  };

  raw.forEach((item, n) => {
    const local: string[] = [];
    const warn = (m: string): void => {
      local.push(m);
    };
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const opName = plain(str(o.op ?? o.action ?? o.type ?? '')).replace(/[^a-z]/g, '');
    const op = OPS[opName];
    const where = `edits[${n}]${op ? ` (${op})` : ''}`;
    try {
      let edit: StudioEdit | undefined;
      switch (op) {
        case undefined:
          throw new Error(
            `${where} : opération « ${str(o.op)} » inconnue (update, insert, remove, move, set, replace)`,
          );
        case 'update': {
          const id = findId(o.id ?? o.segment);
          if (!id) throw new Error(`${where} : segment « ${str(o.id)} » introuvable`);
          const src = (o.fields && typeof o.fields === 'object' ? o.fields : o) as Record<string, unknown>;
          const fields: Record<string, string> & { visual?: Record<string, unknown> | null } = {};
          if ('visual' in src || 'plan' in src) fields.visual = shotFrom(src.visual ?? src.plan, where);
          const t = text(src.text ?? src.texte);
          if (t !== undefined) {
            if (!t) throw new Error(`${where} : texte vide pour « ${id} »`);
            fields.text = t;
          }
          const key = text(src.key ?? src.title ?? src.titre);
          if (key !== undefined) fields.key = key;
          const label = text(src.label ?? src.chapter ?? src.chapitre);
          if (label !== undefined) fields.label = label;
          if (src.mood !== undefined || src.ambiance !== undefined)
            fields.mood = moodOf(src.mood ?? src.ambiance, warn, where);
          // a rename only when asked inside `fields` (at the top level, `id` names the segment)
          const rename =
            o.fields && typeof o.fields === 'object' ? text((o.fields as Record<string, unknown>).id) : undefined;
          if (rename && rename !== id) fields.id = freshId(rename, t ?? '', new Set(ids()));
          if (Object.keys(fields).length === 0) throw new Error(`${where} : aucun champ à modifier pour « ${id} »`);
          edit = { op: 'update', id, fields };
          break;
        }
        case 'insert': {
          const seg = (o.segment && typeof o.segment === 'object' ? o.segment : o) as Record<string, unknown>;
          const existing = findId(seg.id);
          if (existing && text(seg.text)) {
            warn(`${where} : « ${existing} » existe déjà, mis à jour au lieu d'être ajouté`);
            const fields: Record<string, string> = { text: text(seg.text) ?? '' };
            if (seg.mood !== undefined) fields.mood = moodOf(seg.mood, warn, where);
            for (const f of ['key', 'label'] as const) if (text(seg[f]) !== undefined) fields[f] = text(seg[f]) ?? '';
            edit = { op: 'update', id: existing, fields };
            break;
          }
          const segment = segmentFrom(seg, where, new Set(ids()), warn);
          let after: string | null;
          if (o.after === null) after = null;
          else if (o.after === undefined) after = lastInserted ?? ids().at(-1) ?? null;
          else {
            after = findId(o.after);
            if (!after) {
              after = lastInserted ?? ids().at(-1) ?? null;
              warn(`${where} : « ${str(o.after)} » introuvable, inséré ${after ? `après « ${after} »` : 'en tête'}`);
            }
          }
          edit = { op: 'insert', after, segment };
          lastInserted = segment.id;
          break;
        }
        case 'remove': {
          const id = findId(o.id ?? o.segment);
          if (!id) {
            warn(`${where} : « ${str(o.id)} » déjà absent, ignoré`);
            return void warnings.push(...local);
          }
          edit = { op: 'remove', id };
          break;
        }
        case 'move': {
          const id = findId(o.id ?? o.segment);
          if (!id) throw new Error(`${where} : segment « ${str(o.id)} » introuvable`);
          const after = o.after === null || o.after === undefined ? null : findId(o.after);
          if (o.after && !after) throw new Error(`${where} : « ${str(o.after)} » introuvable`);
          edit = { op: 'move', id, after };
          break;
        }
        case 'set': {
          const path = str(o.path ?? o.key ?? '');
          if (!SETTABLE.test(path)) throw new Error(`${where} : « ${path} » ne peut pas être modifié par l'assistant`);
          let value = o.value;
          // numbers and booleans sometimes come as strings
          if (
            typeof value === 'string' &&
            /^music\.(root|gain|duck|seed)|look\.(bloom|exposure|fogDensity)$/.test(path)
          )
            value = Number(value.replace(',', '.'));
          if (typeof value === 'string' && /^music\.(major|enabled)$/.test(path))
            value = /^(true|oui|vrai|1)$/i.test(value);
          edit = { op: 'set', path, value };
          break;
        }
        case 'replace': {
          const list = o.segments ?? o.narration ?? o.value;
          if (!Array.isArray(list) || list.length === 0) throw new Error(`${where} : il faut "segments": [...]`);
          const taken = new Set<string>();
          const segments: SegmentInput[] = [];
          list.forEach((s, k) => {
            try {
              segments.push(segmentFrom((s ?? {}) as Record<string, unknown>, `${where}.segments[${k}]`, taken, warn));
            } catch (err) {
              // one bad segment does not lose the narration
              errors.push(err instanceof Error ? err.message : String(err));
            }
          });
          if (segments.length === 0) throw new Error(`${where} : aucun segment utilisable`);
          edit = { op: 'replace', segments };
          lastInserted = segments.at(-1)?.id ?? null;
          break;
        }
      }
      if (!edit) return;
      // a correction often repeats edits already kept
      const same = JSON.stringify(edit);
      if (edits.some((e) => JSON.stringify(e) === same)) return;
      current = applyEdits(current, [edit]);
      edits.push(edit);
      warnings.push(...local);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  });
  return { capsule: current, edits, warnings, errors };
}
