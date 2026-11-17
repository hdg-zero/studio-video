import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCapsule } from '../src/core/config.js';
import { STUDIO_HOME } from '../src/core/home.js';
import { listMedia, mediaMounts, resolveVisuals } from '../src/core/media.js';
import { loadProject, type Project } from '../src/core/project.js';
import { startServer } from '../src/core/server.js';
import { runOrThrow } from '../src/core/util.js';

let dir: string;
let project: Project;
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'studio-media-'));
  const root = path.join(dir, 'demo');
  cpSync(path.join(STUDIO_HOME, 'templates', 'capsule'), root, { recursive: true });
  mkdirSync(path.join(root, 'media'));
  writeFileSync(path.join(root, 'media', 'photo.jpg'), 'pas vraiment une image');
  writeFileSync(path.join(root, 'media', 'notes.txt'), 'ignoré');
  await runOrThrow('ffmpeg', [
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:r=25',
    '-t',
    '1',
    '-pix_fmt',
    'yuv420p',
    path.join(root, 'media', 'clip.mp4'),
  ]);
  const capsule = JSON.parse(readFileSync(path.join(root, 'capsule.json'), 'utf8')) as {
    segments: Record<string, unknown>[];
    format?: unknown;
  };
  capsule.format = { width: 640, height: 360, fps: 10, pixelRatio: 1 };
  capsule.segments[0] = { ...capsule.segments[0], visual: { type: 'image', src: 'photo.jpg', motion: 'pan-left' } };
  capsule.segments[1] = { ...capsule.segments[1], visual: { type: 'video', src: 'media/clip.mp4' } };
  capsule.segments[2] = { ...capsule.segments[2], visual: { type: 'stat', value: 42, suffix: ' %' } };
  writeFileSync(path.join(root, 'capsule.json'), JSON.stringify(capsule));
  project = await loadProject(root);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('ready-made shots', () => {
  it('fills defaults and refuses what cannot be drawn', () => {
    const base = { title: 'T', segments: [{ id: 'a', text: 'x' }] };
    const one = (visual: unknown) => parseCapsule({ ...base, segments: [{ id: 'a', text: 'x', visual }] });
    expect(one({ type: 'list', items: ['un'] }).segments[0]?.visual).toEqual({
      type: 'list',
      items: ['un'],
      numbered: false,
    });
    expect(() => one({ type: 'chart', data: [] })).toThrow(/visual/);
    expect(() => one({ type: 'image', src: '../capsule.json' })).toThrow(/media/);
    expect(() => one({ type: 'carte' })).toThrow(/visual/);
  });

  it('lists the media files and resolves the shots, clips cut into frames', async () => {
    expect((await listMedia(project)).map((m) => `${m.name}:${m.kind}`)).toEqual(['clip.mp4:video', 'photo.jpg:image']);
    const { visuals, fingerprints } = await resolveVisuals(project, { strict: true });
    const ids = project.capsule.segments.map((s) => s.id);
    expect(visuals[ids[0] ?? '']).toMatchObject({ type: 'image', motion: 'pan-left', fit: 'cover' });
    expect((visuals[ids[0] ?? ''] as { src: string }).src).toMatch(/^media\/photo\.jpg\?v=/);
    const clip = visuals[ids[1] ?? ''] as { type: string; frames: string; count: number; fps: number };
    expect(clip.type).toBe('video');
    expect(clip.fps).toBe(10);
    expect(clip.count).toBeGreaterThanOrEqual(9);
    expect(existsSync(path.join(project.paths.work, clip.frames, '000001.jpg'))).toBe(true);
    expect(fingerprints.size).toBe(3);
    // a second call reuses the frames
    const again = await resolveVisuals(project, { strict: true });
    expect(again.visuals[ids[1] ?? '']).toEqual(clip);
  });

  it('leaves out a shot whose file is missing, or fails a render', async () => {
    const broken = {
      ...project,
      capsule: {
        ...project.capsule,
        segments: project.capsule.segments.map((s, i) =>
          i === 0 ? { ...s, visual: { ...(s.visual as object), src: 'absente.jpg' } as typeof s.visual } : s,
        ),
      },
    };
    const { visuals, problems } = await resolveVisuals(broken);
    expect(Object.keys(visuals)).toHaveLength(2);
    expect(problems[0]).toMatch(/absente\.jpg introuvable/);
    await expect(resolveVisuals(broken, { strict: true })).rejects.toThrow(/absente\.jpg/);
  });

  it('serves media/ and frames/ next to the page, nothing outside', async () => {
    const srv = await startServer(project.paths.bundle, '<p>page</p>', mediaMounts(project));
    try {
      expect(await (await fetch(`${srv.url}media/photo.jpg`)).text()).toBe('pas vraiment une image');
      // a path that climbs out is pinned inside media/
      expect((await fetch(`${srv.url}media/..%2Fcapsule.json`)).status).toBe(404);
      expect((await fetch(`${srv.url}media/absente.jpg`)).status).toBe(404);
    } finally {
      await srv.close();
    }
  });
});
