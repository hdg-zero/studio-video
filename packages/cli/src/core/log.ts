/**
 * Leveled logger with structured events.
 *
 * Every message and progress update is published as a {@link StudioEvent}. The console sink
 * renders them for humans (colours on a TTY, plain lines otherwise); other sinks, such as the
 * web UI's event stream, subscribe with {@link onEvent}.
 */
import { formatDuration } from './util.js';

const tty = process.stderr.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const color = {
  dim: paint(2),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  cyan: paint(36),
  bold: paint(1),
};

export type LogLevel = 'debug' | 'info' | 'step' | 'ok' | 'warn' | 'error';

export interface Progress {
  /** What is progressing, e.g. "render", "tts". */
  readonly task: string;
  readonly done: number;
  readonly total: number;
  /** Items per second, when meaningful. */
  readonly rate?: number;
  /** Estimated seconds left. */
  readonly eta?: number;
  readonly unit?: string;
}

export type StudioEvent =
  | { readonly type: 'log'; readonly level: LogLevel; readonly msg: string; readonly time: number }
  | ({ readonly type: 'progress'; readonly time: number } & Progress);

type Listener = (e: StudioEvent) => void;
const listeners = new Set<Listener>();

/** Subscribes to every log and progress event; returns the unsubscribe function. */
export function onEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let verbose = Boolean(process.env.STUDIO_DEBUG);
export const setVerbose = (v: boolean): void => {
  verbose = v;
};

let statusShown = false;
const clearStatus = (): void => {
  if (statusShown) process.stderr.write('\r\x1b[2K');
  statusShown = false;
};

const PREFIX: Record<LogLevel, string> = {
  debug: '',
  info: '',
  step: `${color.cyan('▸')} `,
  ok: `${color.green('✓')} `,
  warn: `${color.yellow('!')} `,
  error: `${color.red('✗')} `,
};

function emit(level: LogLevel, msg: string): void {
  if (level === 'debug' && !verbose) return;
  for (const l of listeners) l({ type: 'log', level, msg, time: Date.now() });
  clearStatus();
  process.stderr.write(`${PREFIX[level]}${level === 'debug' ? color.dim(msg) : msg}\n`);
}

let lastPlainProgress = 0;

export const log = {
  info: (msg: string): void => emit('info', msg),
  step: (msg: string): void => emit('step', msg),
  ok: (msg: string): void => emit('ok', msg),
  warn: (msg: string): void => emit('warn', msg),
  error: (msg: string): void => emit('error', msg),
  debug: (msg: string): void => emit('debug', msg),
  /** Progress update: a structured event, and a status line rewritten in place on a TTY. */
  progress: (p: Progress): void => {
    for (const l of listeners) l({ type: 'progress', time: Date.now(), ...p });
    const line = `  ${p.done}/${p.total} ${p.unit ?? ''}${p.rate !== undefined ? ` · ${p.rate.toFixed(1)}/s` : ''}${p.eta !== undefined && Number.isFinite(p.eta) ? ` · reste ~${formatDuration(p.eta)}` : ''}`;
    if (tty) {
      process.stderr.write(`\r\x1b[2K${line}`);
      statusShown = true;
    } else if (Date.now() - lastPlainProgress > 10_000 || p.done === p.total) {
      // log files get one line every 10 s
      lastPlainProgress = Date.now();
      process.stderr.write(`${line}\n`);
    }
  },
};
