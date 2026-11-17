/**
 * Bundles a project's scenes with the runtime and three.js into one ES module + one stylesheet
 * (esbuild: ~100 ms, no per-project node_modules), and fingerprints the code each scene depends on
 * so the renderer can re-render only the chunks whose code actually changed.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { STUDIO_HOME } from './home.js';
import type { Project } from './project.js';
import { sha256 } from './util.js';

export interface BundleResult {
  readonly dir: string;
  /** Fingerprint of everything shared by all frames (runtime, three.js, world setup, styles). */
  readonly globalHash: string;
  /** Fingerprint of each scene's own code, keyed by scene id (= file name in `scenes/`). */
  readonly sceneHashes: ReadonlyMap<string, string>;
  /** Fingerprint used for scenes that do not live in `scenes/<id>.ts`. */
  readonly fallbackHash: string;
  readonly warnings: readonly string[];
}

/** Name of the virtual entry module in esbuild's metafile. */
const ENTRY = '<studio-entry>';

function entrySource(project: Project): string {
  const imports = [
    `import { boot } from '@studio/runtime';`,
    `import '@studio/runtime/styles.css';`,
    existsSync(project.paths.styles) ? `import ${JSON.stringify(project.paths.styles)};` : '',
    `import capsule from ${JSON.stringify(project.paths.sceneEntry)};`,
  ];
  return `${imports.filter(Boolean).join('\n')}
const config = window.__STUDIO_BOOT__;
const report = (message) => {
  if (window.parent !== window) window.parent.postMessage({ studio: 'error', message }, location.origin);
};
window.addEventListener('error', (e) => report(e.message));
boot(capsule, config).catch((err) => {
  console.error(err);
  window.__STUDIO_ERROR__ = String((err && err.stack) || err);
  report(window.__STUDIO_ERROR__);
});
`;
}

export function bundleOptions(project: Project): esbuild.BuildOptions {
  return {
    stdin: { contents: entrySource(project), resolveDir: STUDIO_HOME, sourcefile: ENTRY, loader: 'js' },
    absWorkingDir: STUDIO_HOME,
    nodePaths: [path.join(STUDIO_HOME, 'node_modules')],
    outdir: project.paths.bundle,
    entryNames: 'bundle',
    assetNames: 'assets/[name]-[hash]',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
    minify: true,
    sourcemap: 'linked',
    metafile: true,
    loader: { '.woff': 'file', '.woff2': 'file', '.png': 'file', '.jpg': 'file', '.glsl': 'text' },
    logLevel: 'silent',
  };
}

export async function bundleProject(project: Project): Promise<BundleResult> {
  let result: esbuild.BuildResult<{ metafile: true }>;
  try {
    result = await esbuild.build({ ...bundleOptions(project), metafile: true });
  } catch (err) {
    const failure = err as esbuild.BuildFailure;
    const msgs = await esbuild.formatMessages(failure.errors, { kind: 'error', color: process.stderr.isTTY });
    throw new Error(`scene bundle failed:\n${msgs.join('\n') || failure.message}`, { cause: err });
  }
  const warnings = await esbuild.formatMessages(result.warnings, { kind: 'warning' });
  return { dir: project.paths.bundle, ...(await fingerprint(project, result.metafile)), warnings };
}

/** Splits the bundle's import graph into a shared part and one closure per scene file. */
async function fingerprint(
  project: Project,
  meta: esbuild.Metafile,
): Promise<Pick<BundleResult, 'globalHash' | 'sceneHashes' | 'fallbackHash'>> {
  const abs = (p: string): string => path.resolve(STUDIO_HOME, p);
  const contents = new Map<string, string>();
  await Promise.all(
    Object.keys(meta.inputs).map(async (p) => {
      contents.set(p, p === ENTRY ? entrySource(project) : sha256(await readFile(abs(p))));
    }),
  );
  const sceneDir = project.paths.scenes + path.sep;
  const sceneFiles = Object.keys(meta.inputs).filter((p) => {
    const a = abs(p);
    return a.startsWith(sceneDir) && a !== project.paths.sceneEntry && /\.[cm]?[jt]sx?$/.test(a);
  });
  const sceneSet = new Set(sceneFiles);

  const closure = (start: string, stopAtScenes: boolean): string[] => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const f = stack.pop() as string;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const imp of meta.inputs[f]?.imports ?? []) {
        if (imp.external || !(imp.path in meta.inputs)) continue;
        if (stopAtScenes && sceneSet.has(imp.path)) continue;
        stack.push(imp.path);
      }
    }
    return [...seen].sort();
  };
  const hashOf = (files: readonly string[]): string => sha256(...files.flatMap((f) => [f, contents.get(f) ?? '']));

  const sceneHashes = new Map<string, string>();
  for (const f of sceneFiles) {
    sceneHashes.set(path.basename(f).replace(/\.[^.]+$/, ''), hashOf(closure(f, false)));
  }
  return {
    globalHash: hashOf(closure(ENTRY, true)),
    sceneHashes,
    fallbackHash: hashOf(sceneFiles.flatMap((f) => closure(f, false))),
  };
}
