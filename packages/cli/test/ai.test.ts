import { describe, expect, it } from 'vitest';
import { parseChunk } from '../src/ai/openrouter.js';
import { identifierFor, registerScene } from '../src/core/scenes.js';

describe('parseChunk', () => {
  it('reads a text delta', () => {
    expect(parseChunk('{"choices":[{"delta":{"content":"Bonjour"}}]}')).toEqual({ text: 'Bonjour' });
  });

  it('reads the usage of the last chunk', () => {
    const chunk = '{"choices":[{"delta":{}}],"usage":{"prompt_tokens":120,"completion_tokens":30,"cost":0.002}}';
    expect(parseChunk(chunk)).toEqual({
      usage: { promptTokens: 120, completionTokens: 30, cachedTokens: 0, cost: 0.002 },
    });
  });

  it('reports an error sent mid-stream', () => {
    expect(parseChunk('{"error":{"message":"quota dépassé"}}')).toEqual({ error: 'quota dépassé' });
  });

  it('ignores what is not JSON', () => {
    expect(parseChunk('[DONE')).toEqual({});
  });
});

describe('identifierFor', () => {
  it('turns a segment id into a JS identifier', () => {
    expect(identifierFor('mon-segment_2')).toBe('monSegment2');
    expect(identifierFor('1786')).toBe('s1786');
  });

  it('avoids keywords and names already taken', () => {
    expect(identifierFor('class')).toBe('classScene');
    expect(identifierFor('intro', new Set(['intro']))).toBe('introScene');
  });
});

const INDEX = `import { defineCapsule } from '@studio/runtime';
import intro from './intro.js';
import outro from './outro.js';

export default defineCapsule({
  scenes: [intro, outro],
});
`;

describe('registerScene', () => {
  const order = ['intro', 'milieu', 'outro'];

  it('imports the scene and places it in segment order', () => {
    const { source, registered } = registerScene(INDEX, 'milieu', order);
    expect(registered).toBe(true);
    expect(source).toContain("import milieu from './milieu.js';");
    expect(source).toContain('scenes: [intro, milieu, outro]');
  });

  it('puts a scene first when no earlier segment has one', () => {
    const { source } = registerScene(INDEX, 'avant', ['avant', ...order]);
    expect(source).toContain('scenes: [avant, intro, outro]');
  });

  it('keeps the last scene last for a scene that is not a segment', () => {
    const { source } = registerScene(INDEX, 'extra', order);
    expect(source).toContain('scenes: [intro, extra, outro]');
  });

  it('leaves the file alone when the scene is already there or the shape is unknown', () => {
    expect(registerScene(INDEX, 'intro', order)).toEqual({ source: INDEX, registered: false });
    const custom = 'export default makeScenes();\n';
    expect(registerScene(custom, 'milieu', order)).toEqual({ source: custom, registered: false });
  });
});
