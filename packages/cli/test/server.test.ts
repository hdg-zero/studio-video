import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listen, resolveInside, sendFile, urlPathOf } from '../src/core/server.js';

describe('resolveInside', () => {
  it('keeps paths inside the root', () => {
    expect(resolveInside('/srv/root', '/a/b.js')).toBe('/srv/root/a/b.js');
    expect(resolveInside('/srv/root', '/../etc/passwd')).toBe('/srv/root/etc/passwd');
    expect(resolveInside('/srv/root', '/a/../../x')).toBe('/srv/root/x');
  });
});

describe('sendFile', () => {
  let url = '';
  let close: () => Promise<void> = () => Promise.resolve();
  beforeAll(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'studio-test-'));
    await writeFile(path.join(dir, 'clip.mp4'), '0123456789');
    const srv = await listen((req, res) => sendFile(req, res, path.join(dir, urlPathOf(req).slice(1))));
    url = srv.url;
    close = srv.close;
  });
  afterAll(() => close());

  it('serves whole files with their type', async () => {
    const res = await fetch(`${url}clip.mp4`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(await res.text()).toBe('0123456789');
  });

  it('serves byte ranges, so a video can seek', async () => {
    const res = await fetch(`${url}clip.mp4`, { headers: { range: 'bytes=2-5' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await res.text()).toBe('2345');
    const tail = await fetch(`${url}clip.mp4`, { headers: { range: 'bytes=-3' } });
    expect(await tail.text()).toBe('789');
    const bad = await fetch(`${url}clip.mp4`, { headers: { range: 'bytes=20-' } });
    expect(bad.status).toBe(416);
  });

  it('answers 404 for a missing file', async () => {
    expect((await fetch(`${url}nope.mp4`)).status).toBe(404);
  });
});
