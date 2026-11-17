import { existsSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { log } from '../core/log.js';

/**
 * Notifies when a project's files change, including changes made outside the UI (an editor,
 * the CLI, an agent). Render chunks and preview bundles are ignored: they change constantly.
 */
export function watchProjects(root: string, changed: (name: string) => void): FSWatcher | null {
  if (!existsSync(root)) return null;
  const ignored = /(^|\/)(\.studio\/(chunks|bundle|preview)|node_modules)(\/|$)|\.tmp$|\.part\.mp4$/;
  const timers = new Map<string, NodeJS.Timeout>();
  try {
    return watch(root, { recursive: true }, (_event, file) => {
      if (!file) return;
      const rel = file.split(path.sep).join('/');
      if (ignored.test(rel)) return;
      const name = rel.split('/')[0] ?? '';
      clearTimeout(timers.get(name));
      timers.set(
        name,
        setTimeout(() => {
          timers.delete(name);
          changed(name);
        }, 400),
      );
    });
  } catch {
    log.warn('surveillance des fichiers indisponible : rafraîchir la page après une modification externe');
    return null;
  }
}
