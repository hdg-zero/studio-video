#!/usr/bin/env node
// Entry point of the `studio` command (built by `npm run build`).
const entry = new URL('../packages/cli/dist/studio.js', import.meta.url);
import(entry.href).catch((err) => {
  if (err && err.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).includes('dist/studio.js')) {
    console.error('studio: CLI not built yet, run `npm run build` in the studio folder.');
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
