import { describe, expect, it } from 'vitest';
import { compactAnswer, parseAnswer } from '../src/ai/blocks.js';
import { applyEdits, describeEdit, readEdits } from '../src/ai/edits.js';
import { applyPatch } from '../src/ai/patch.js';

const capsule = {
  title: 'Titre',
  music: { root: 50 },
  segments: [
    { id: 'a', mood: 'calm', text: 'Un.' },
    { id: 'b', mood: 'pulse', text: 'Deux.' },
    { id: 'c', mood: 'calm', text: 'Trois.' },
  ],
};
const ids = (c: Record<string, unknown>): string[] => (c.segments as { id: string }[]).map((s) => s.id);

describe('parseAnswer', () => {
  it('splits text, studio blocks and code', () => {
    const answer = [
      'Voici :',
      '```studio-edits',
      '{"edits":[{"op":"remove","id":"b"}]}',
      '```',
      '```scene:a',
      "const s = '```';",
      '```',
      '```scene-patch:c',
      '<<<<<<< SEARCH',
      'x',
      '=======',
      'y',
      '>>>>>>> REPLACE',
      '```',
      '```js',
      'x()',
      '```',
      'Fin.',
    ].join('\n');
    const parts = parseAnswer(answer);
    expect(parts.map((p) => p.kind)).toEqual(['text', 'edits', 'scene', 'patch', 'code', 'text']);
    expect(parts[2]).toMatchObject({ kind: 'scene', id: 'a', code: "const s = '```';\n", complete: true });
    expect(parts[3]).toMatchObject({ kind: 'patch', id: 'c', complete: true });
  });

  it('marks a block still being written as incomplete', () => {
    expect(parseAnswer('Je propose :\n```studio-edits\n{"edits":[{"op":').at(-1)).toMatchObject({
      kind: 'edits',
      complete: false,
    });
  });
});

describe('readEdits', () => {
  it('accepts the object or a bare array', () => {
    expect(readEdits('{"edits":[1]}')).toEqual([1]);
    expect(readEdits('[2]')).toEqual([2]);
  });

  it('explains what is wrong', () => {
    expect(() => readEdits('{oops}')).toThrow(/JSON invalide/);
    expect(() => readEdits('{"changes":[]}')).toThrow(/"edits"/);
  });
});

describe('applyEdits', () => {
  it('updates, inserts, moves and removes segments without touching the input', () => {
    const out = applyEdits(capsule, [
      { op: 'update', id: 'a', fields: { text: 'Un, réécrit.' } },
      { op: 'insert', after: 'a', segment: { id: 'n', text: 'Nouveau.' } },
      { op: 'move', id: 'c', after: null },
      { op: 'remove', id: 'b' },
    ]);
    expect(ids(out)).toEqual(['c', 'a', 'n']);
    expect((out.segments as { text: string }[])[1]?.text).toBe('Un, réécrit.');
    expect((out.segments as { mood: string }[])[2]?.mood).toBe('calm');
    expect(ids(capsule)).toEqual(['a', 'b', 'c']);
  });

  it('sets allowed settings without dropping their neighbours', () => {
    const out = applyEdits(capsule, [
      { op: 'set', path: 'title', value: 'Autre' },
      { op: 'set', path: 'music.major', value: true },
    ]);
    expect(out.title).toBe('Autre');
    expect(out.music).toEqual({ root: 50, major: true });
  });

  it('names the failing edit', () => {
    expect(() => applyEdits(capsule, [{ op: 'remove', id: 'z' }])).toThrow(
      'edits[0] (remove) : segment « z » introuvable',
    );
    expect(() => applyEdits(capsule, [{ op: 'insert', after: null, segment: { id: 'a', text: '' } }])).toThrow(
      /existe déjà/,
    );
    expect(() => applyEdits(capsule, [{ op: 'set', path: 'format.fps', value: 60 }])).toThrow(/ne peut pas/);
  });

  it('describes edits in French', () => {
    expect(describeEdit({ op: 'update', id: 'a', fields: { text: 'x', key: 'y' } })).toBe('« a » : texte, titre');
  });
});

describe('applyPatch', () => {
  const source = 'line one\n  bloom.strength = 0.9;   \nline three\n';
  const patch = (search: string, replace: string): string =>
    `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;

  it('replaces the matching lines', () => {
    expect(applyPatch(source, patch('line three', 'line 3'))).toBe('line one\n  bloom.strength = 0.9;   \nline 3\n');
  });

  it('ignores trailing spaces the model did not copy', () => {
    const search = '  bloom.strength = 0.9;\nline three';
    expect(applyPatch(source, patch(search, '  bloom.strength = 1.4;\nline 3'))).toBe(
      'line one\n  bloom.strength = 1.4;\nline 3\n',
    );
  });

  it('applies several pairs in order', () => {
    expect(applyPatch('a\nb\n', `${patch('a', 'A')}\n${patch('b', 'B')}`)).toBe('A\nB\n');
  });

  it('refuses a missing or ambiguous search', () => {
    expect(() => applyPatch(source, patch('absent', 'x'))).toThrow(/introuvable/);
    expect(() => applyPatch('x\nx\n', patch('x', 'y'))).toThrow(/ambigu/);
    expect(() => applyPatch(source, 'nothing')).toThrow(/aucune paire/);
  });
});

describe('compactAnswer', () => {
  it('keeps the words and replaces the blocks by a summary', () => {
    const answer = 'Voici.\n```scene:a\nlong code\n```\n```studio-edits\n{"edits":[]}\n```';
    expect(compactAnswer(answer, 'applied')).toBe(
      'Voici.\n\n[scenes/a.ts complet, validé et appliqué]\n\n[bloc studio-edits, validé et appliqué]',
    );
  });
});
