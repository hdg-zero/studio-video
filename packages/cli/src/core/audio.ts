/**
 * Bridge to the Python audio package (numpy): soundtrack synthesis, mix, voice check.
 * DSP over millions of samples is vectorised in numpy; the CLI only passes paths and settings.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AUDIO_PACKAGE_SRC, STUDIO_HOME } from './home.js';
import type { Project } from './project.js';
import { log } from './log.js';
import { runStreamed, sha256, writeFileAtomic } from './util.js';
import { clipPath } from './tts.js';

/** `$STUDIO_PYTHON`, else the studio's `.venv`, else `python3` from PATH. */
export function pythonCommand(): string {
  if (process.env.STUDIO_PYTHON) return process.env.STUDIO_PYTHON;
  const venv = path.join(STUDIO_HOME, '.venv', 'bin', 'python');
  return existsSync(venv) ? venv : 'python3';
}

/** Runs `python -m studio_audio …`; its output goes to the log, Ctrl+C or a cancel stops it. */
function runAudio(args: readonly string[], signal?: AbortSignal): Promise<void> {
  const pythonPath = [AUDIO_PACKAGE_SRC, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  return runStreamed(pythonCommand(), ['-m', 'studio_audio', ...args], {
    env: { ...process.env, PYTHONPATH: pythonPath, PYTHONUNBUFFERED: '1' },
    onLine: (line) => log.info(line),
    signal,
  });
}

export interface MusicOptions {
  readonly noVoice?: boolean;
  readonly signal?: AbortSignal;
}

export async function mixSoundtrack(project: Project, opts: MusicOptions = {}): Promise<string> {
  const m = project.capsule.music;
  // prettier-ignore
  const args = [
    'mix',
    '--timeline', project.paths.timeline,
    '--voice-dir', project.paths.voice,
    '--out-dir', project.paths.audio,
    '--root', String(m.root),
    '--music-gain', String(m.enabled ? m.gain : 0),
    '--duck', String(m.duck),
    '--seed', String(m.seed),
  ];
  if (m.major) args.push('--major');
  if (opts.noVoice) args.push('--no-voice');
  await runAudio(args, opts.signal);
  const info: MixInfo = { inputs: await mixInputs(project), noVoice: Boolean(opts.noVoice) };
  await writeFileAtomic(project.paths.mixInfo, `${JSON.stringify(info)}\n`);
  return project.paths.mix;
}

/** Written next to the mix: the mix is stale as soon as its inputs hash changes. */
export interface MixInfo {
  readonly inputs: string;
  readonly noVoice: boolean;
}

/** Fingerprint of everything the mix depends on: music settings, timeline, voice clips. */
export async function mixInputs(project: Project): Promise<string> {
  const read = (f: string): Promise<string> => (existsSync(f) ? readFile(f, 'utf8') : Promise.resolve(''));
  return sha256(
    JSON.stringify(project.capsule.music),
    await read(project.paths.timeline),
    await read(project.paths.voiceManifest),
  );
}

export async function checkVoices(project: Project, signal?: AbortSignal): Promise<void> {
  const files = project.capsule.segments.map((s) => clipPath(project, s.id)).filter((f) => existsSync(f));
  await runAudio(['voicecheck', ...files], signal);
}
