/** Small process, file and concurrency utilities shared by the commands. */
import { spawn, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

export const sha256 = (...parts: (string | Buffer)[]): string => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p).update('\0');
  return h.digest('hex');
};

/** Writes through a temporary file and a rename, so readers never see a half-written file. */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command to completion and captures its output. Rejects only if it cannot start. */
export function run(cmd: string, args: readonly string[], opts: SpawnOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Like {@link run} but throws with stderr when the command fails. */
export async function runOrThrow(cmd: string, args: readonly string[], opts: SpawnOptions = {}): Promise<string> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} ${args.slice(0, 4).join(' ')}… failed (${r.code}):\n${r.stderr.trim()}`);
  return r.stdout;
}

export interface StreamOptions extends Pick<SpawnOptions, 'env' | 'cwd'> {
  /** Called for every line the command prints (stdout and stderr). */
  readonly onLine: (line: string) => void;
  /** Kills the command (SIGTERM) when aborted. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Runs a long command and streams its output line by line (to the log, hence to the terminal
 * and the web UI). Rejects when the command fails or is aborted.
 */
export function runStreamed(cmd: string, args: readonly string[], opts: StreamOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    opts.signal?.throwIfAborted();
    const child = spawn(cmd, args, { env: opts.env, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = (): void => {
      child.kill('SIGTERM');
    };
    opts.signal?.addEventListener('abort', kill, { once: true });
    for (const stream of [child.stdout, child.stderr]) {
      let rest = '';
      stream.on('data', (d: Buffer) => {
        const lines = (rest + d.toString()).split('\n');
        rest = lines.pop() ?? '';
        for (const l of lines) if (l.trim()) opts.onLine(l);
      });
      stream.on('end', () => {
        if (rest.trim()) opts.onLine(rest);
      });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', kill);
      if (opts.signal?.aborted) reject(abortReason(opts.signal));
      else if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

/** The error to throw for an aborted signal (its reason when it is an Error). */
export const abortReason = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new Error('cancelled');

/** True for the error produced by a cancellation (Ctrl+C, cancel button). */
export const isAbort = (err: unknown): boolean => err instanceof Error && err.name === 'AbortError';

/** Runs `worker` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i] as T, i);
    }
  });
  await Promise.all(lanes);
  return results;
}

/** Waits `ms`, or rejects early when `signal` is aborted. */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '?';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : m ? `${m}min${String(s % 60).padStart(2, '0')}` : `${s}s`;
};

export const formatBytes = (n: number): string =>
  n > 1 << 30
    ? `${(n / (1 << 30)).toFixed(2)} Go`
    : n > 1 << 20
      ? `${(n / (1 << 20)).toFixed(1)} Mo`
      : `${Math.round(n / 1024)} Ko`;
