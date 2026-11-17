/**
 * The assistant's answer format, shared by the server (checks, application) and the browser
 * (display while streaming). Pure functions only: this module is bundled into the web UI.
 *
 * An answer is free text with fenced blocks the studio understands:
 *   ```studio-edits        {"edits": [...]}            changes to capsule.json
 *   ```scene:<id>          full scenes/<id>.ts          new or rewritten scene
 *   ```scene-patch:<id>    SEARCH/REPLACE pairs         small change to an existing scene
 *
 * Models do not always follow it to the letter: a ```json block holding {"edits": …} and a
 * ```ts block holding `defineScene('<id>'` are read as the blocks they obviously are.
 *
 * What the blocks hold is read elsewhere: capsule edits in edits.ts, scene patches in patch.ts.
 */

export type Part =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly lang: string; readonly code: string; readonly complete: boolean }
  | { readonly kind: 'edits'; readonly body: string; readonly complete: boolean }
  | { readonly kind: 'scene'; readonly id: string; readonly code: string; readonly complete: boolean }
  | { readonly kind: 'patch'; readonly id: string; readonly body: string; readonly complete: boolean };

export type BlockPart = Extract<Part, { kind: 'edits' | 'scene' | 'patch' }>;
export const isBlock = (p: Part): p is BlockPart => p.kind === 'edits' || p.kind === 'scene' || p.kind === 'patch';

/** Splits an answer (possibly still streaming) into text, code and studio blocks. */
export function parseAnswer(content: string): Part[] {
  const parts: Part[] = [];
  // a fence opens at the start of a line; the closing fence too (code may contain ``` in strings)
  const fence = /^```([^\n`]*)\n([\s\S]*?)(^```[ \t]*$|$(?![\s\S]))/gm;
  let last = 0;
  for (const m of content.matchAll(fence)) {
    if (m.index > last) parts.push({ kind: 'text', text: content.slice(last, m.index) });
    last = m.index + m[0].length;
    const lang = (m[1] ?? '').trim();
    const body = m[2] ?? '';
    const complete = (m[3] ?? '').startsWith('```');
    const tag = /^(studio[-_ ]?edits|scene[-_ ]?patch|scene)\s*(?::\s*(.*))?$/i.exec(lang);
    const kind = tag?.[1]?.toLowerCase().replace(/[-_ ]/g, '');
    const id = sceneId(tag?.[2] ?? '');
    if (kind === 'studioedits') parts.push({ kind: 'edits', body, complete });
    else if (kind === 'scenepatch' && id) parts.push({ kind: 'patch', id, body, complete });
    else if (kind === 'scene' && id) parts.push({ kind: 'scene', id, code: body, complete });
    else if (/^json5?$/i.test(lang) && /^\s*\{\s*"edits"\s*:/.test(body)) parts.push({ kind: 'edits', body, complete });
    else if (/^(ts|typescript|js|javascript)?$/i.test(lang) && /export\s+default\s+defineScene\(/.test(body)) {
      const declared = /defineScene\(\s*(['"`])([^'"`]+)\1/.exec(body)?.[2];
      parts.push(
        declared ? { kind: 'scene', id: declared, code: body, complete } : { kind: 'code', lang, code: body, complete },
      );
    } else parts.push({ kind: 'code', lang, code: body, complete });
  }
  if (last < content.length) parts.push({ kind: 'text', text: content.slice(last) });
  return parts.filter((p) => p.kind !== 'text' || p.text.trim());
}

/** `scenes/Idee.ts` → `idee` (what the model writes after `scene:` varies). */
const sceneId = (raw: string): string =>
  raw
    .trim()
    .replace(/^.*\//, '')
    .replace(/\.(ts|js)$/, '')
    .toLowerCase();

/**
 * An earlier answer as sent back to the model: its blocks are replaced by a one-line summary.
 * The current files and capsule are in the system prompt anyway, so repeating old code would
 * only cost tokens (and could mislead the model about the current state).
 */
export function compactAnswer(content: string, outcome: 'applied' | 'pending' | 'undone' = 'pending'): string {
  const state = { applied: 'validé et appliqué', pending: 'non appliqué', undone: 'appliqué puis annulé' }[outcome];
  return parseAnswer(content)
    .map((p) => {
      switch (p.kind) {
        case 'text':
          return p.text.trim();
        case 'code':
          return `[bloc ${p.lang || 'de code'} omis]`;
        case 'edits':
          return `[bloc studio-edits, ${state}]`;
        case 'scene':
          return `[scenes/${p.id}.ts complet, ${state}]`;
        case 'patch':
          return `[retouche de scenes/${p.id}.ts, ${state}]`;
      }
    })
    .join('\n\n');
}
