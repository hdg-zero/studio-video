/** New projects, copied from `templates/capsule`. */
import { existsSync } from 'node:fs';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SHORT_TIMING, VERTICAL_FORMAT } from './config.js';
import { STUDIO_HOME, TEMPLATES_DIR } from './home.js';
import { projectsRoot } from './status.js';

export const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]*$/;

export interface CreateOptions {
  /** Vertical short video (1080x1920, short timings, word-by-word subtitles). */
  readonly vertical?: boolean;
}

/** Creates `<dir>/<name>` from the template and returns its path. */
export async function createProject(
  name: string,
  title = name,
  dir = projectsRoot(),
  { vertical = false }: CreateOptions = {},
): Promise<string> {
  if (!PROJECT_NAME.test(name)) throw new Error('project names use lowercase letters, digits, - and _');
  const dest = path.join(path.resolve(dir), name);
  if (existsSync(dest)) throw new Error(`${dest} already exists`);
  await cp(path.join(TEMPLATES_DIR, 'capsule'), dest, { recursive: true });
  const capsuleFile = path.join(dest, 'capsule.json');
  const capsule = JSON.parse(await readFile(capsuleFile, 'utf8')) as Record<string, unknown>;
  capsule.title = title;
  if (typeof capsule.credits === 'string') capsule.credits = capsule.credits.replace('Nouvelle capsule', title);
  if (vertical) {
    capsule.format = { ...VERTICAL_FORMAT, fps: 30 };
    capsule.timing = { ...SHORT_TIMING };
  }
  capsule.$schema = path.relative(dest, path.join(STUDIO_HOME, 'schemas', 'capsule.schema.json'));
  await writeFile(capsuleFile, `${JSON.stringify(capsule, null, 2)}\n`);
  return dest;
}
