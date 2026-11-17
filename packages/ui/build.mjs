// Bundles the web UI: one ES module + one stylesheet (fonts copied as assets), minified.
// `node packages/ui/build.mjs --watch` rebuilds on change while working on the UI.
import { copyFile, mkdir } from 'node:fs/promises';
import { context } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const watch = process.argv.includes('--watch');

await mkdir(`${here}dist`, { recursive: true });
await copyFile(`${here}src/index.html`, `${here}dist/index.html`);
const ctx = await context({
  entryPoints: { app: `${here}src/main.tsx` },
  outdir: `${here}dist`,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome110',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: !watch,
  sourcemap: 'linked',
  assetNames: 'assets/[name]-[hash]',
  loader: { '.woff': 'file', '.woff2': 'file' },
  logLevel: 'warning',
});
if (watch) {
  await ctx.watch();
  console.log('ui: watching…');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
