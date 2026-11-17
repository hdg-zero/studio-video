import { describe, expect, it } from 'vitest';
import { layoutOf, parseCapsule } from '../src/core/config.js';

const minimal = { title: 'T', segments: [{ id: 'intro', text: 'Bonjour.' }] };

describe('parseCapsule', () => {
  it('fills defaults', () => {
    const c = parseCapsule(minimal);
    expect(c.format).toEqual({ width: 1920, height: 1080, fps: 30, pixelRatio: 1.5 });
    expect(c.segments[0]?.mood).toBe('calm');
    expect(c.timing.credits).toBe(6);
    expect(layoutOf(c.format)).toEqual({ width: 1280, height: 720 });
  });

  it('reports every field error with its path', () => {
    const bad = {
      title: 'T',
      segments: [
        { id: 'a', text: 'x', mood: 'happy' },
        { id: 'credits', text: 'z' },
      ],
    };
    expect(() => parseCapsule(bad)).toThrow(/segments\.0\.mood[\s\S]*segments\.1\.id: « credits » est réservé/);
  });

  it('checks cross-field rules once the fields are valid', () => {
    const bad = {
      title: 'T',
      format: { width: 1081 },
      segments: [
        { id: 'a', text: 'x' },
        { id: 'a', text: 'y' },
      ],
    };
    expect(() => parseCapsule(bad)).toThrow(/segments\.1\.id: identifiant « a » en double[\s\S]*paires/);
  });
});
