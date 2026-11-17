/**
 * Compiles the scene files the assistant proposes, with the real project around them:
 * esbuild for syntax, imports and missing exports, then TypeScript (loaded on demand) for wrong
 * API use. Messages are phrased for the model.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import type * as TS from 'typescript';
import { bundleOptions } from '../core/bundle.js';
import { STUDIO_HOME } from '../core/home.js';
import { log } from '../core/log.js';
import type { Project } from '../core/project.js';

/** Errors reported per file and per check. */
export const MAX_REPORT = 6;
const rel = (project: Project, file: string): string => path.relative(project.paths.root, file) || file;

/** An error found in the proposed files (`file`: null when it is not tied to one). */
export interface Failure {
  readonly file: string | null;
  readonly message: string;
}

/** Bundles the project's scenes with the proposed files in place of the ones on disk. */
export async function compile(project: Project, files: ReadonlyMap<string, string>): Promise<Failure[]> {
  const overlay: esbuild.Plugin = {
    name: 'proposed-scenes',
    setup(build) {
      // a new scene does not exist on disk yet: resolve `./<id>.js` to the proposed file
      build.onResolve({ filter: /^\.\/[\w-]+\.js$/ }, (args) => {
        const file = path.join(args.resolveDir, args.path.replace(/\.js$/, '.ts'));
        return files.has(file) ? { path: file } : undefined;
      });
      build.onLoad({ filter: /\.ts$/ }, (args) => {
        const contents = files.get(args.path);
        return contents === undefined ? undefined : { contents, loader: 'ts', resolveDir: path.dirname(args.path) };
      });
    },
  };
  try {
    await esbuild.build({
      ...bundleOptions(project),
      write: false,
      sourcemap: false,
      minify: false,
      plugins: [overlay],
    });
    return [];
  } catch (err) {
    const failure = err as Partial<esbuild.BuildFailure>;
    if (!failure.errors) return [{ file: null, message: err instanceof Error ? err.message : String(err) }];
    return failure.errors.slice(0, MAX_REPORT).map((m) => {
      const loc = m.location ? `${rel(project, m.location.file)}:${m.location.line}:${m.location.column} ` : '';
      return {
        file: m.location?.file ?? null,
        message: `compilation : ${loc}${m.text}${m.location?.lineText ? `\n    ${m.location.lineText.trim()}` : ''}`,
      };
    });
  }
}

type Ts = typeof TS;
let tsModule: Ts | null | undefined;
let lastProgram: TS.Program | undefined;

/** Unused names are not worth a correction round. */
const IGNORED = new Set([6133, 6138, 6192, 6196, 6198, 6205]);

/**
 * Type-checks the proposed files against the runtime's and three.js's types (≈2 s). Catches what
 * the model gets wrong most often: a helper that does not exist, a wrong field of the context.
 * Skipped when TypeScript is not installed.
 */
export async function typecheck(project: Project, files: ReadonlyMap<string, string>): Promise<Failure[]> {
  if (tsModule === undefined) tsModule = await import('typescript').then((m) => m.default).catch(() => null);
  const ts = tsModule;
  if (!ts) {
    log.debug('assistant : TypeScript absent, scènes vérifiées sans typage');
    return [];
  }
  const types = path.join(STUDIO_HOME, 'node_modules', '@types', 'three');
  if (!existsSync(types)) return [];
  const options: TS.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    strict: true,
    noUncheckedIndexedAccess: true,
    isolatedModules: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
    paths: {
      '@studio/runtime': [path.join(STUDIO_HOME, 'packages', 'runtime', 'src', 'index.ts')],
      three: [path.join(types, 'index.d.ts')],
      'three/*': [path.join(types, '*')],
    },
  };
  const host = ts.createCompilerHost(options);
  const disk = {
    getSourceFile: host.getSourceFile.bind(host),
    fileExists: host.fileExists.bind(host),
    readFile: host.readFile.bind(host),
  };
  host.fileExists = (f) => files.has(f) || disk.fileExists(f);
  host.readFile = (f) => files.get(f) ?? disk.readFile(f);
  host.getSourceFile = (f, lang, ...rest) => {
    const text = files.get(f);
    return text === undefined ? disk.getSourceFile(f, lang, ...rest) : ts.createSourceFile(f, text, lang);
  };
  const started = Date.now();
  const roots = [...files.keys()].filter((f) => f.endsWith('.ts'));
  const program = ts.createProgram({ rootNames: roots, options, host, oldProgram: lastProgram });
  lastProgram = program;
  const out: Failure[] = [];
  for (const f of roots) {
    const sf = program.getSourceFile(f);
    if (!sf) continue;
    for (const d of [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]) {
      if (IGNORED.has(d.code)) continue;
      const pos = d.start === undefined ? null : sf.getLineAndCharacterOfPosition(d.start);
      const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 300);
      out.push({
        file: f,
        message: `typage : ${rel(project, f)}${pos ? `:${pos.line + 1}:${pos.character + 1}` : ''} ${msg}`,
      });
    }
  }
  log.debug(`assistant : vérification des types en ${Date.now() - started} ms`);
  return out;
}
