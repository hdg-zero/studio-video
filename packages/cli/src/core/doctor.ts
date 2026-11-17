/** Environment diagnosis shared by `studio doctor` and the web UI. */
import os from 'node:os';
import { pythonCommand } from './audio.js';
import { PROFILES, probeProfile, selectProfile } from './browser.js';
import { availableEncoders } from './encoder.js';
import { apiKeyAvailable } from './tts.js';
import { run } from './util.js';

export interface DoctorCheck {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
  /** A failed blocking check prevents rendering; others only slow it down or disable a feature. */
  readonly blocking: boolean;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  readonly cpuThreads: number;
  /** Selected WebGL backend and renderer string, when Chromium starts. */
  readonly gpu: { readonly profile: string; readonly renderer: string; readonly hardware: boolean } | null;
  readonly ok: boolean;
}

export const GPU_HELP =
  'Pas de GPU détecté : vérifiez mesa / vulkan-icd-loader (+ vulkan-radeon, vulkan-intel ou nvidia-utils), ou essayez CHROME_PATH=/usr/bin/chromium. Le rendu fonctionne quand même, en plus lent.';

export async function diagnose(opts: { refreshGpu?: boolean } = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const add = (label: string, ok: boolean, detail = '', blocking = true): void => {
    checks.push({ label, ok, detail, blocking });
  };

  add('Node.js ≥ 22', Number(process.versions.node.split('.')[0]) >= 22, process.version);

  const ff = await run('ffmpeg', ['-version']).catch(() => null);
  add('ffmpeg', ff?.code === 0, ff?.stdout.split('\n')[0] ?? 'introuvable (pacman -S ffmpeg)');
  if (ff?.code === 0) {
    const enc = await availableEncoders();
    add('encodeur libx264', enc.has('x264'));
    add(
      'encodeur matériel',
      enc.has('vaapi') || enc.has('nvenc'),
      [...enc].filter((e) => e !== 'x264').join(', ') || 'aucun (optionnel)',
      false,
    );
  }

  for (const p of PROFILES) {
    const r = await probeProfile(p);
    add(`WebGL ${p.name}`, Boolean(r), r ?? 'indisponible', false);
  }
  let gpu: DoctorReport['gpu'] = null;
  try {
    const sel = await selectProfile('auto', { refresh: Boolean(opts.refreshGpu) });
    gpu = { profile: sel.profile.name, renderer: sel.renderer, hardware: sel.profile.hardware };
    add('rendu GPU', sel.profile.hardware, `${sel.profile.name} → ${sel.renderer}`, false);
  } catch (err) {
    add('Chromium', false, (err as Error).message.split('\n')[0] ?? '');
  }

  const py = await run(pythonCommand(), [
    '-c',
    'import numpy, sys; print(sys.version.split()[0], numpy.__version__)',
  ]).catch(() => null);
  add(
    'Python + numpy',
    py?.code === 0,
    py?.code === 0 ? `${pythonCommand()} (${py.stdout.trim()})` : `${pythonCommand()} : numpy manquant (npm run setup)`,
  );
  add('OPENROUTER_API_KEY', apiKeyAvailable(), 'nécessaire seulement pour générer des voix', false);

  return {
    checks,
    cpuThreads: os.availableParallelism(),
    gpu,
    ok: checks.every((c) => c.ok || !c.blocking),
  };
}
