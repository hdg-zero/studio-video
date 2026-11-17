import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    // the sources sit one level deeper than the bundled CLI that STUDIO_HOME is computed for
    env: { STUDIO_HOME: fileURLToPath(new URL('.', import.meta.url)) },
  },
});
