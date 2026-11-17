/** Scene patches of the assistant (`scene-patch:<id>` blocks): SEARCH/REPLACE pairs. */

const PATCH = /<{7} SEARCH\n([\s\S]*?)\n?={7}\n([\s\S]*?)\n?>{7} REPLACE/g;

/**
 * Applies SEARCH/REPLACE pairs to a scene. Each SEARCH must occur exactly once; whitespace at the
 * end of lines is ignored, a frequent difference between the model's copy and the file.
 */
export function applyPatch(source: string, body: string): string {
  const pairs = [...body.matchAll(PATCH)];
  if (pairs.length === 0)
    throw new Error('aucune paire <<<<<<< SEARCH / ======= / >>>>>>> REPLACE reconnue dans le bloc');
  let out = source;
  for (const [, search = '', replace = ''] of pairs) {
    const at = locate(out, search);
    out = out.slice(0, at.start) + replace + out.slice(at.end);
  }
  return out;
}

function locate(source: string, search: string): { start: number; end: number } {
  const exact = source.indexOf(search);
  if (exact >= 0 && search) {
    if (source.indexOf(search, exact + 1) >= 0)
      throw new Error(`SEARCH ambigu (plusieurs occurrences) : « ${firstLine(search)} »`);
    return { start: exact, end: exact + search.length };
  }
  // same lines, trailing spaces ignored
  const trim = (s: string): string[] => s.split('\n').map((l) => l.trimEnd());
  const lines = source.split('\n');
  const want = trim(search);
  const found: number[] = [];
  for (let i = 0; i + want.length <= lines.length; i++)
    if (want.every((w, k) => (lines[i + k] ?? '').trimEnd() === w)) found.push(i);
  if (found.length !== 1)
    throw new Error(
      found.length
        ? `SEARCH ambigu (plusieurs occurrences) : « ${firstLine(search)} »`
        : `SEARCH introuvable dans le fichier : « ${firstLine(search)} » (recopier exactement les lignes actuelles)`,
    );
  const offset = (line: number): number => lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  const startLine = found[0] ?? 0;
  const end = offset(startLine + want.length) - 1;
  return { start: offset(startLine), end: Math.max(offset(startLine), end) };
}

const firstLine = (s: string): string => (s.trim().split('\n')[0] ?? '').slice(0, 80);
