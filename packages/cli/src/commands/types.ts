import type { ParseArgsConfig } from 'node:util';

export type Options = NonNullable<ParseArgsConfig['options']>;

export interface ParsedArgs {
  readonly values: Record<string, string | boolean | string[] | undefined>;
  readonly positionals: string[];
}

export interface CommandContext {
  /** Aborted on Ctrl+C / SIGTERM: long steps stop cleanly (finished work stays cached). */
  readonly signal: AbortSignal;
  /** `--json`: the command prints nothing on stdout; its return value is printed as JSON. */
  readonly json: boolean;
}

export interface Command {
  readonly name: string;
  /** One line shown in `studio help`. */
  readonly summary: string;
  /** Usage line(s) and option help shown in `studio help <command>`. */
  readonly usage: string;
  readonly options: Options;
  /** Returns the command's result: printed with `--json`, so scripts and agents can read it. */
  run(args: ParsedArgs, ctx: CommandContext): Promise<unknown>;
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export const list = (v: unknown): string[] | undefined =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

export function int(v: unknown, name: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`--${name} expects a positive integer, got "${typeof v === 'string' ? v : typeof v}"`);
  return n;
}

export function oneOf<T extends string>(v: unknown, name: string, allowed: readonly T[], fallback: T): T {
  if (v === undefined) return fallback;
  if (!allowed.includes(v as T)) throw new Error(`--${name} must be one of ${allowed.join(', ')}`);
  return v as T;
}

export function requireProject(args: ParsedArgs): string {
  const ref = args.positionals[0];
  if (!ref) throw new Error('missing <project> (a folder with capsule.json, or a name under ./projects)');
  return ref;
}
