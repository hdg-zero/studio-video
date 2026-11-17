/**
 * Minimal HTTP building blocks, built in so a render never depends on downloading a server
 * (`npx http-server`): file responses with byte ranges (video seeking), a server-sent-events
 * hub for live reload, and the static server used by renders and previews.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
};

/** Decoded path of a request URL (no query string). */
export const urlPathOf = (req: http.IncomingMessage): string =>
  decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);

/** Resolves a URL path inside `root`, or returns null when it would escape it. */
export function resolveInside(root: string, urlPath: string): string | null {
  const base = path.resolve(root);
  const file = path.resolve(base, `.${path.posix.normalize(`/${urlPath}`)}`);
  return file === base || file.startsWith(base + path.sep) ? file : null;
}

/** Sends a file, honouring `Range` (needed to seek in a video). Answers 404 when it is not a file. */
export async function sendFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: string,
  cacheControl = 'no-store',
): Promise<void> {
  let size: number;
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    size = st.size;
  } catch {
    res.writeHead(404).end();
    return;
  }
  const headers: http.OutgoingHttpHeaders = {
    'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': cacheControl,
    'accept-ranges': 'bytes',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': end - start + 1,
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

/** Server-sent events fan-out. */
export class EventHub {
  readonly #clients = new Set<http.ServerResponse>();

  /** Adds a client; `first` is sent to it alone (initial state). */
  attach(req: http.IncomingMessage, res: http.ServerResponse, first?: string): void {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(first === undefined ? ': ok\n\n' : EventHub.frame(first));
    this.#clients.add(res);
    req.on('close', () => this.#clients.delete(res));
  }

  send(data: string): void {
    const frame = EventHub.frame(data);
    for (const c of this.#clients) c.write(frame);
  }

  static frame(data: string): string {
    return `data: ${data.replace(/\n/g, '\ndata: ')}\n\n`;
  }

  close(): void {
    for (const c of this.#clients) c.end();
    this.#clients.clear();
  }
}

/**
 * Serves `/` (the in-memory page), `/__reload` (live reload), the bundle files under `dir`, and
 * other folders under URL prefixes (`mounts`, e.g. `/media/` → the project's pictures).
 */
export function bundleHandler(
  dir: string,
  page: () => string,
  reload: EventHub,
  mounts: Readonly<Record<string, string>> = {},
): (req: http.IncomingMessage, res: http.ServerResponse, urlPath: string) => Promise<void> {
  return async (req, res, urlPath) => {
    const mount = Object.keys(mounts).find((prefix) => urlPath.startsWith(prefix));
    if (mount) {
      const file = resolveInside(mounts[mount] ?? dir, urlPath.slice(mount.length));
      if (!file) res.writeHead(403).end();
      // content-addressed URLs (`?v=` hash, frame folders named by hash): cacheable
      else await sendFile(req, res, file, 'max-age=86400');
      return;
    }
    if (urlPath === '/' || urlPath === '/index.html') {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      res.end(page());
      return;
    }
    if (urlPath === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    if (urlPath === '/__reload') {
      reload.attach(req, res);
      return;
    }
    const file = resolveInside(dir, urlPath);
    if (!file) {
      res.writeHead(403).end();
      return;
    }
    await sendFile(req, res, file);
  };
}

export interface StaticServer {
  readonly url: string;
  setPage(html: string): void;
  /** Sends a reload event to connected preview pages. */
  reload(): void;
  close(): Promise<void>;
}

/** Wraps a request handler in a server bound to 127.0.0.1 (`port` 0 = any free port). */
export async function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>,
  port = 0,
  host = '127.0.0.1',
): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    handler(req, res).catch((err: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(err instanceof Error ? err.message : String(err));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const { port: bound } = server.address() as AddressInfo;
  return {
    server,
    url: `http://${host.includes(':') ? `[${host}]` : host}:${bound}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export async function startServer(
  dir: string,
  page: string,
  mounts: Readonly<Record<string, string>> = {},
  port = 0,
): Promise<StaticServer> {
  let html = page;
  const hub = new EventHub();
  const handle = bundleHandler(dir, () => html, hub, mounts);
  const srv = await listen((req, res) => handle(req, res, urlPathOf(req)), port);
  return {
    url: srv.url,
    setPage: (h) => {
      html = h;
    },
    reload: () => hub.send('reload'),
    close: async () => {
      hub.close();
      await srv.close();
    },
  };
}
