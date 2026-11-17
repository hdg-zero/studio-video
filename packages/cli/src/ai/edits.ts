/**
 * Capsule edits of the assistant (`studio-edits` blocks): their shape, how they are read from a
 * block, applied to capsule.json and described on the validation card. Pure functions only:
 * this module is bundled into the web UI.
 */

/** One change to capsule.json. */
export type StudioEdit =
  | {
      readonly op: 'update';
      readonly id: string;
      readonly fields: Partial<Record<'id' | 'mood' | 'label' | 'key' | 'text', string>> & {
        /** Ready-made shot; null removes it. */
        readonly visual?: ShotInput | null;
      };
    }
  | {
      readonly op: 'insert';
      readonly after: string | null;
      readonly segment: SegmentInput;
    }
  | { readonly op: 'remove'; readonly id: string }
  | { readonly op: 'move'; readonly id: string; readonly after: string | null }
  | { readonly op: 'set'; readonly path: string; readonly value: unknown }
  /** The whole narration at once (writing a capsule from a subject). */
  | { readonly op: 'replace'; readonly segments: readonly SegmentInput[] };

/** A ready-made shot as written in capsule.json (`{type: 'image', src: …}`), checked by the capsule schema. */
export type ShotInput = Readonly<Record<string, unknown>>;

export type SegmentInput = Record<'id' | 'text', string> &
  Partial<Record<'mood' | 'label' | 'key', string>> & { readonly visual?: ShotInput };

/** Reads a `studio-edits` block (repairing common JSON slips); throws a message for the model otherwise. */
export function readEdits(body: string): unknown[] {
  let data: unknown;
  try {
    data = lenientJson(body);
  } catch (err) {
    throw new Error(`bloc studio-edits : JSON invalide (${err instanceof Error ? err.message : String(err)})`, {
      cause: err,
    });
  }
  if (Array.isArray(data)) return data as unknown[];
  const obj = data as { edits?: unknown; op?: unknown } | null;
  if (Array.isArray(obj?.edits)) return obj.edits as unknown[];
  if (obj && typeof obj.op === 'string') return [obj];
  throw new Error('bloc studio-edits : il faut un objet {"edits": [...]}');
}

/**
 * JSON.parse, and when it fails, a second try after fixing what models get wrong in long JSON:
 * comments, trailing commas, raw line breaks in strings, unescaped quotes inside a text
 * (« il dit "bonjour" »), a missing closing bracket at the very end.
 */
function lenientJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (first) {
    try {
      return JSON.parse(repairJson(text));
    } catch {
      throw first;
    }
  }
}

function repairJson(text: string): string {
  let out = '';
  let inString = false;
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (inString) {
      if (c === '\\') {
        out += c + (text[i + 1] ?? '');
        i++;
      } else if (c === '"') {
        // a quote that does not end the string (next significant character is not , : } ]) is text
        const next = /\S/.exec(text.slice(i + 1))?.[0];
        if (next === undefined || ',:}]'.includes(next)) {
          inString = false;
          out += c;
        } else out += '\\"';
      } else if (c === '\n') out += '\\n';
      else if (c === '\r') continue;
      else if (c === '\t') out += '\\t';
      else out += c;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      out = out.replace(/,\s*$/, '');
      stack.pop();
    }
    out += c;
  }
  if (inString) out += '"';
  out = out.replace(/,\s*$/, '');
  return out + stack.reverse().join('');
}

type SegmentDraft = Record<string, unknown>;
type Capsule = Record<string, unknown>;

/** Settings the assistant may change with `set` (the rest stays under the user's control). */
export const SETTABLE =
  /^(title|kicker|closingLine|credits|language|music\.(root|major|gain|duck|seed|enabled)|look\.(accent|background|bloom|exposure|fogDensity))$/;

/** Applies edits to a raw capsule (never mutated); throws with a message for the model on a bad edit. */
export function applyEdits(capsule: Capsule, edits: readonly StudioEdit[]): Capsule {
  let segments: SegmentDraft[] = Array.isArray(capsule.segments)
    ? (capsule.segments as SegmentDraft[]).map((s) => ({ ...s }))
    : [];
  let out: Capsule = { ...capsule };
  edits.forEach((e, n) => {
    const where = `edits[${n}] (${e.op})`;
    const indexOf = (id: string): number => {
      const i = segments.findIndex((s) => s.id === id);
      if (i < 0) throw new Error(`${where} : segment « ${id} » introuvable`);
      return i;
    };
    const position = (after: string | null): number => (after === null ? 0 : indexOf(after) + 1);
    switch (e.op) {
      case 'update': {
        const i = indexOf(e.id);
        const { visual, ...rest } = e.fields;
        const next: Record<string, unknown> = { ...segments[i], ...rest };
        if (visual === null) delete next.visual;
        else if (visual) next.visual = visual;
        segments[i] = next;
        break;
      }
      case 'insert':
        if (segments.some((s) => s.id === e.segment.id))
          throw new Error(`${where} : le segment « ${e.segment.id} » existe déjà (utiliser update)`);
        segments.splice(position(e.after), 0, { mood: 'calm', ...e.segment });
        break;
      case 'remove': {
        const i = indexOf(e.id);
        segments = segments.filter((_, k) => k !== i);
        break;
      }
      case 'move': {
        const [seg] = segments.splice(indexOf(e.id), 1);
        if (seg) segments.splice(position(e.after), 0, seg);
        break;
      }
      case 'replace':
        if (e.segments.length === 0) throw new Error(`${where} : aucun segment fourni`);
        segments = e.segments.map((seg) => ({ mood: 'calm', ...seg }));
        break;
      case 'set': {
        if (!SETTABLE.test(e.path))
          throw new Error(`${where} : « ${e.path} » ne peut pas être modifié par l'assistant`);
        const [head, key] = e.path.split('.') as [string, string | undefined];
        if (key === undefined) out = { ...out, [head]: e.value };
        else {
          const prev = out[head];
          out = { ...out, [head]: { ...(prev && typeof prev === 'object' ? prev : {}), [key]: e.value } };
        }
        break;
      }
    }
  });
  return { ...out, segments };
}

const FIELD_NAMES: Record<string, string> = {
  text: 'texte',
  key: 'titre',
  label: 'chapitre',
  mood: 'ambiance',
  id: 'identifiant',
  visual: 'plan à l’écran',
};

/** One line per edit, for the validation card. */
export function describeEdit(e: StudioEdit): string {
  switch (e.op) {
    case 'update':
      return `« ${e.id} » : ${Object.keys(e.fields)
        .map((f) => FIELD_NAMES[f] ?? f)
        .join(', ')}`;
    case 'insert':
      return `nouveau segment « ${e.segment.id} »${e.after ? ` après « ${e.after} »` : ' en tête'}`;
    case 'remove':
      return `supprimer « ${e.id} »`;
    case 'move':
      return `déplacer « ${e.id} »${e.after ? ` après « ${e.after} »` : ' en tête'}`;
    case 'set':
      return `${e.path} → ${JSON.stringify(e.value)}`;
    case 'replace':
      return `narration remplacée : ${e.segments.length} segments (${e.segments.map((s) => s.id).join(', ')})`;
  }
}
