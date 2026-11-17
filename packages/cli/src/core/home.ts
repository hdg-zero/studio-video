/** Locations of the studio installation itself (not of a project). */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

/** Repository root: the CLI is bundled to `<root>/packages/cli/dist/studio.js`. */
export const STUDIO_HOME = process.env.STUDIO_HOME ?? path.resolve(fileURLToPath(import.meta.url), '../../../..');

export const AUDIO_PACKAGE_SRC = path.join(STUDIO_HOME, 'packages', 'audio', 'src');
export const TEMPLATES_DIR = path.join(STUDIO_HOME, 'templates');

/** Per-user cache (GPU probe result…), following the XDG convention. */
export const USER_CACHE = path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'studio-video');
