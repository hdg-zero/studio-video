// Bundles the CLI into a single ESM file: fast startup, no TypeScript at run time.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

await build({
  entryPoints: [`${here}src/main.ts`],
  outfile: `${here}dist/studio.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'linked',
  // native binaries, browser drivers and the type checker (loaded only when needed) stay external
  external: ['esbuild', 'playwright', 'playwright-core', 'typescript'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
