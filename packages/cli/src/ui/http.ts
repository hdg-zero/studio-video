/** HTTP plumbing of the UI server: errors with a status, JSON in and out, origin checks. */
import type http from 'node:http';
import type { z } from 'zod';
import type { ApiError } from './protocol.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: ApiError['issues'],
  ) {
    super(message);
  }
}

/** Rejects requests for another host name, and cross-site requests that change something. */
export function checkOrigin(req: http.IncomingMessage, allowedHosts: ReadonlySet<string>): void {
  const host = req.headers.host ?? '';
  if (!allowedHosts.has(host)) throw new HttpError(403, `unexpected host "${host}"`);
  const origin = req.headers.origin;
  if (req.method !== 'GET' && req.method !== 'HEAD' && origin && new URL(origin).host !== host)
    throw new HttpError(403, 'cross-site request');
}

export function json(res: http.ServerResponse, body: unknown, status = 200): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

export async function readJson(req: http.IncomingMessage): Promise<unknown> {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json'))
    throw new HttpError(415, 'expected application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > 2 << 20) throw new HttpError(413, 'body too large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  throw new HttpError(422, issues.map((i) => `${i.path || '(racine)'} : ${i.message}`).join('\n'), issues);
}
