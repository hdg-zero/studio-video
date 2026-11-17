/** Project files the UI reads and writes: deliverables, imported media, voice clips. */
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { mediaKind } from '../core/media.js';
import { PCM_RATE } from '../core/tts.js';
import { HttpError } from './http.js';

/** Files of a project the UI may read (deliverables and previews, never the sources). */
export const READABLE = [
  /^media\/[^/]+$/,
  /^out\/[^/]+\.(mp4|png)$/,
  /^\.studio\/stills\/[^/]+\.png$/,
  /^\.studio\/contact_sheet\.png$/,
  /^\.studio\/audio\/mix_norm\.wav$/,
];

/** Max size of an imported picture or clip. */
const MAX_MEDIA = 512 << 20;

/** Stores an uploaded file in `media/` under a clean, unused name; returns that name. */
export async function saveMedia(dir: string, wanted: string, req: http.IncomingMessage): Promise<string> {
  const ext = path.extname(wanted).toLowerCase();
  if (!mediaKind(wanted)) throw new HttpError(415, `format non pris en charge (${ext || 'sans extension'})`);
  const base =
    path
      .basename(wanted, path.extname(wanted))
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'media';
  await mkdir(dir, { recursive: true });
  let name = `${base}${ext}`;
  for (let n = 2; existsSync(path.join(dir, name)); n++) name = `${base}-${n}${ext}`;
  const tmp = path.join(dir, `.${name}.part`);
  let size = 0;
  try {
    await pipeline(
      req,
      async function* (source: AsyncIterable<Buffer>) {
        for await (const c of source) {
          size += c.length;
          if (size > MAX_MEDIA) throw new HttpError(413, 'fichier trop gros (512 Mo au plus)');
          yield c;
        }
      },
      createWriteStream(tmp),
    );
    if (size === 0) throw new HttpError(400, 'fichier vide');
    await rename(tmp, path.join(dir, name));
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return name;
}

/** Raw PCM clips get a WAV header so the browser can play them. */
export async function sendClip(res: http.ServerResponse, file: string): Promise<void> {
  if (!existsSync(file)) throw new HttpError(404, 'no voice clip');
  const pcm = await readFile(file);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(PCM_RATE, 24);
  header.writeUInt32LE(PCM_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': 44 + pcm.length, 'cache-control': 'no-store' });
  res.end(Buffer.concat([header, pcm]));
}
