import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPlan, undoPlan } from '../src/ai/apply.js';
import { absorb, emptyProposal, verify } from '../src/ai/check.js';
import { parseAnswer, isBlock } from '../src/ai/blocks.js';
import { STUDIO_HOME } from '../src/core/home.js';
import { loadProject, type Project } from '../src/core/project.js';

let dir: string;
let project: Project;
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'studio-check-'));
  cpSync(path.join(STUDIO_HOME, 'templates', 'capsule'), path.join(dir, 'demo'), { recursive: true });
  project = await loadProject(path.join(dir, 'demo'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const idee = (): string => readFileSync(path.join(dir, 'demo', 'scenes', 'idee.ts'), 'utf8');

/** Runs an answer through the same steps as the chat endpoint. */
async function check(answer: string, types = true) {
  const state = emptyProposal();
  const blockErrors = await absorb(project, state, parseAnswer(answer).filter(isBlock));
  const result = await verify(project, state, { types });
  return { ...result, errors: [...blockErrors, ...result.errors] };
}
const fence = (lang: string, body: string): string => `\`\`\`${lang}\n${body}\n\`\`\``;

describe('verify', () => {
  it('accepts valid edits', async () => {
    const { errors, plan } = await check(
      fence('studio-edits', '{"edits":[{"op":"update","id":"idee","fields":{"text":"Autre texte."}}]}'),
    );
    expect(errors).toEqual([]);
    expect(plan.edits).toHaveLength(1);
  });

  it('keeps the valid edits and names the ones left out', async () => {
    const { errors, plan } = await check(
      fence(
        'studio-edits',
        JSON.stringify({
          edits: [
            { op: 'update', id: 'idee', fields: { text: '' } },
            { op: 'update', id: 'absent', fields: { text: 'x' } },
            { op: 'set', path: 'look.accent', value: 'orange' },
            { op: 'update', id: 'intro', fields: { text: 'Gardé.' } },
          ],
        }),
      ),
    );
    expect(errors.join('\n')).toMatch(/texte vide pour « idee »/);
    expect(errors.join('\n')).toMatch(/« absent » introuvable/);
    expect(errors.join('\n')).toMatch(/look\.accent/);
    expect(plan.edits).toEqual([{ op: 'update', id: 'intro', fields: { text: 'Gardé.' } }]);
  });

  it('fixes what has an obvious meaning', async () => {
    const answer = fence(
      'json',
      `{"edits": [
        {"op": "add", "segment": {"id": "Nouvelle Idée", "mood": "montée", "text": "Il dit "oui" puis
s'en va."}},
        {"op": "edit", "id": "intro", "text": "Autre accroche.", "mood": "joyeux"},
        {"op": "delete", "id": "fantome"},
      ]}`,
    );
    const { errors, plan } = await check(answer);
    expect(errors).toEqual([]);
    expect(plan.edits).toEqual([
      {
        op: 'insert',
        after: 'outro',
        segment: { id: 'nouvelle-idee', text: 'Il dit "oui" puis\ns\'en va.', mood: 'build' },
      },
      { op: 'update', id: 'intro', fields: { text: 'Autre accroche.', mood: 'calm' } },
    ]);
    expect(plan.warnings.join('\n')).toMatch(/joyeux/);
    expect(plan.warnings.join('\n')).toMatch(/fantome/);
  });

  it('writes a whole narration with one replace, keeping the good segments', async () => {
    const { errors, plan } = await check(
      fence(
        'studio-edits',
        JSON.stringify({
          edits: [
            {
              op: 'replace',
              segments: [
                { id: 'accroche', mood: 'intro', text: 'Une question.' },
                { id: 'accroche', text: 'Même identifiant.' },
                { id: 'vide', text: '' },
                { id: 'credits', mood: 'finale', text: 'La fin.' },
              ],
            },
          ],
        }),
      ),
    );
    expect(errors.join('\n')).toMatch(/segments\[2\] : texte manquant/);
    const replace = plan.edits[0];
    expect(replace?.op === 'replace' && replace.segments.map((s) => s.id)).toEqual([
      'accroche',
      'accroche-2',
      'credits-2',
    ]);
  });

  it('accepts ready-made shots written loosely, and keeps the text when a shot is wrong', async () => {
    mkdirSync(path.join(dir, 'demo', 'media'), { recursive: true });
    writeFileSync(path.join(dir, 'demo', 'media', 'tour.jpg'), 'x');
    const edits = {
      edits: [
        {
          op: 'replace',
          segments: [
            { id: 'a', text: 'Un.', visual: { type: 'chiffre', value: '8 100', suffix: ' hab.' } },
            { id: 'b', text: 'Deux.', visual: { type: 'graphique', data: { Afrique: 2140, Asie: '2290' } } },
            { id: 'c', text: 'Trois.', visual: { type: 'image', src: 'media/tour.jpg' } },
            { id: 'd', text: 'Quatre.', visual: { type: 'image', src: 'absente.jpg' } },
            { id: 'e', text: 'Cinq.', visual: { type: 'list', items: [] } },
          ],
        },
      ],
    };
    const { errors, plan } = await check(fence('studio-edits', JSON.stringify(edits)), false);
    const replace = plan.edits[0];
    expect(replace?.op).toBe('replace');
    if (replace?.op !== 'replace') return;
    // every text is kept; only the two bad shots are left out
    expect(replace.segments.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(replace.segments.map((s) => s.visual?.type)).toEqual(['stat', 'chart', 'image', undefined, undefined]);
    expect(replace.segments[0]?.visual?.value).toBe(8100);
    expect(replace.segments[1]?.visual?.data).toEqual([
      { label: 'Afrique', value: 2140 },
      { label: 'Asie', value: 2290 },
    ]);
    expect(replace.segments[2]?.visual?.src).toBe('tour.jpg');
    expect(errors.join('\n')).toMatch(/« d ».*absente\.jpg n'existe pas.*tour\.jpg/);
    expect(errors.join('\n')).toMatch(/« e ».*visual\.items/);
  });

  it('sets a shot named in French', async () => {
    const capsule = JSON.parse(readFileSync(project.paths.capsule, 'utf8')) as { segments: Record<string, unknown>[] };
    const { plan } = await check(
      fence(
        'studio-edits',
        '{"edits":[{"op":"update","id":"idee","fields":{"visual":{"type":"titre","text":"Babel"}}}]}',
      ),
      false,
    );
    expect(plan.edits[0]).toEqual({ op: 'update', id: 'idee', fields: { visual: { type: 'title', text: 'Babel' } } });
    expect(capsule.segments.find((s) => s.id === 'idee')?.visual).toBeUndefined();
  });

  it('checks the scene id, the bundle and the types', async () => {
    const wrongId = await check(fence('scene:idee', idee().replace("defineScene('idee'", "defineScene('autre'")));
    expect(wrongId.errors.join('\n')).toMatch(/defineScene\('autre'\) au lieu de defineScene\('idee'\)/);

    const syntax = await check(fence('scene:idee', idee().replace('group.add(form);', 'group.add(form;')));
    expect(syntax.errors.join('\n')).toMatch(/compilation : scenes\/idee\.ts:\d+/);

    const missing = await check(
      fence('scene:idee', idee().replace('defineScene, smooth', 'defineScene, smooth, wobble')),
    );
    expect(missing.errors.join('\n')).toMatch(/wobble/);

    const typed = await check(fence('scene:idee', idee().replace('bloom.strength = 0.8;', 'bloom.intensity = 0.8;')));
    expect(typed.errors.join('\n')).toMatch(/typage : scenes\/idee\.ts:\d+:\d+ .*intensity/);
  }, 30_000);

  it('applies a patch to the file on disk', async () => {
    const patch = '<<<<<<< SEARCH\n    bloom.strength = 0.8;\n=======\n    bloom.strength = 1.2;\n>>>>>>> REPLACE';
    const { errors, plan } = await check(fence('scene-patch:idee', patch), false);
    expect(errors).toEqual([]);
    expect(plan.scenes[0]).toMatchObject({ id: 'idee', created: false, added: 1, removed: 1 });
    expect(plan.scenes[0]?.code).toContain('bloom.strength = 1.2;');
  });

  it('asks for a full file when patching a scene that does not exist', async () => {
    const { errors } = await check(fence('scene-patch:nouveau', '<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE'));
    expect(errors.join('\n')).toMatch(/n'existe pas/);
  });
});

describe('applyPlan', () => {
  it('writes a new segment and its scene, registers it, and undoes it all', async () => {
    const capsuleBefore = readFileSync(project.paths.capsule, 'utf8');
    const indexBefore = readFileSync(project.paths.sceneEntry, 'utf8');
    const code = idee().replaceAll("'idee'", "'neuf'");
    const applied = await applyPlan(project, {
      edits: [{ op: 'insert', after: 'idee', segment: { id: 'neuf', text: 'Un segment neuf.' } }],
      scenes: [{ id: 'neuf', code }],
    });
    expect([...applied.files].sort()).toEqual(['capsule.json', 'scenes/index.ts', 'scenes/neuf.ts']);
    expect(readFileSync(project.paths.sceneEntry, 'utf8')).toMatch(/scenes: \[intro, idee, neuf, outro\]/);

    await undoPlan(project, applied.undo);
    expect(readFileSync(project.paths.capsule, 'utf8')).toBe(capsuleBefore);
    expect(readFileSync(project.paths.sceneEntry, 'utf8')).toBe(indexBefore);
    expect(existsSync(path.join(dir, 'demo', 'scenes', 'neuf.ts'))).toBe(false);
    await expect(undoPlan(project, applied.undo)).rejects.toThrow(/rien à annuler/);
  });

  it('refuses a plan that no longer fits the capsule', async () => {
    await expect(applyPlan(project, { edits: [{ op: 'remove', id: 'absent' }], scenes: [] })).rejects.toThrow(
      /a changé/,
    );
  });

  it('keeps a passing scene when another one fails', async () => {
    const good = idee().replace('bloom.strength = 0.8;', 'bloom.strength = 1;');
    const bad = idee().replaceAll("'idee'", "'intro'").replace('group.add(form);', 'group.add(form;');
    const { plan, errors } = await check(`${fence('scene:idee', good)}\n${fence('scene:intro', bad)}`, false);
    expect(plan.scenes.map((s) => s.id)).toEqual(['idee']);
    expect(plan.dropped).toEqual(['scène « intro »']);
    expect(errors.join('\n')).toMatch(/scenes\/intro\.ts/);
  });
});
