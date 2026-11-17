/** Commands of the production pipeline: tts → timeline → music → stills → render. */
import { CODECS, GPU_MODES, runAction, type ActionKind, type ActionOptions } from '../core/actions.js';
import { checkVoices } from '../core/audio.js';
import { log } from '../core/log.js';
import { loadProject } from '../core/project.js';
import { int, list, oneOf, requireProject, str, type Command, type CommandContext, type ParsedArgs } from './types.js';

const renderOptions = {
  draft: { type: 'boolean' },
  gpu: { type: 'string' },
  codec: { type: 'string' },
  workers: { type: 'string', short: 'j' },
  'chunk-frames': { type: 'string' },
  only: { type: 'string' },
  output: { type: 'string', short: 'o' },
} as const;

/** Reads every pipeline option that is present on the command line. */
function actionOptions(args: ParsedArgs): ActionOptions {
  const v = args.values;
  return {
    only: list(v.only),
    force: Boolean(v.force),
    check: Boolean(v.check),
    estimate: Boolean(v.estimate),
    noVoice: Boolean(v['no-voice']),
    draft: Boolean(v.draft),
    gpu: oneOf(v.gpu, 'gpu', GPU_MODES, 'auto'),
    codec: oneOf(v.codec, 'codec', CODECS, 'x264'),
    workers: int(v.workers, 'workers'),
    chunkFrames: int(v['chunk-frames'], 'chunk-frames'),
    output: str(v.output),
  };
}

const step =
  (kind: ActionKind, extra: (args: ParsedArgs) => Partial<ActionOptions> = () => ({})) =>
  async (args: ParsedArgs, ctx: CommandContext): Promise<unknown> =>
    runAction(await loadProject(requireProject(args)), kind, { ...actionOptions(args), ...extra(args) }, ctx.signal);

export const tts: Command = {
  name: 'tts',
  summary: 'génère la voix off (parallèle, avec cache par texte)',
  usage: `studio tts <projet> [--only id1,id2] [--force] [--check]
  --only     régénère seulement ces segments
  --force    régénère tout
  --check    vérifie ensuite que tous les clips ont la même voix (hauteur médiane)
Clé : variable d'environnement OPENROUTER_API_KEY.`,
  options: { only: { type: 'string' }, force: { type: 'boolean' }, check: { type: 'boolean' } },
  run: step('tts'),
};

export const voicecheck: Command = {
  name: 'voicecheck',
  summary: 'détecte un clip prononcé par une autre voix',
  usage: 'studio voicecheck <projet>',
  options: {},
  async run(args, ctx) {
    await checkVoices(await loadProject(requireProject(args)), ctx.signal);
    return { ok: true };
  },
};

export const timeline: Command = {
  name: 'timeline',
  summary: 'calcule la timeline (la voix pilote les durées)',
  usage: `studio timeline <projet> [--estimate]
  --estimate   estime les durées depuis le texte quand la voix manque (travail sans clé)`,
  options: { estimate: { type: 'boolean' } },
  run: step('timeline'),
};

export const music: Command = {
  name: 'music',
  summary: 'synthétise la musique selon les ambiances et la mixe sous la voix',
  usage: `studio music <projet> [--no-voice]
Réglages dans capsule.json → "music" (root, major, gain, duck, seed).`,
  options: { 'no-voice': { type: 'boolean' } },
  run: step('music'),
};

export const stills: Command = {
  name: 'stills',
  summary: 'rend quelques images et une planche contact pour vérifier le cadrage',
  usage: `studio stills <projet> [t1 t2 …] [--gpu auto|gpu|cpu]
Sans temps : une image au milieu de chaque segment. Affiche le chemin de la planche (PNG).`,
  options: { gpu: { type: 'string' } },
  async run(args, ctx) {
    const times = args.positionals.slice(1).map(Number);
    if (times.some((t) => !Number.isFinite(t) || t < 0))
      throw new Error('times are seconds, e.g. `studio stills demo 2 8.5 20`');
    const result = await step('stills', () => ({ times }))(args, ctx);
    if (!ctx.json) log.ok((result as { file: string }).file);
    return result;
  },
};

export const renderCmd: Command = {
  name: 'render',
  summary: 'rendu MP4 parallèle et incrémental',
  usage: `studio render <projet> [options]
  --draft             brouillon rapide (720p, x264 veryfast)
  --only id1,id2      seulement ces segments (le son suit si la sélection est contiguë)
  -j, --workers N     navigateurs en parallèle (défaut : moitié des threads CPU, max 8)
  --gpu MODE          auto (défaut) | gpu (exige le GPU) | cpu (SwiftShader)
  --codec C           x264 (défaut) | vaapi (GPU Intel/AMD) | nvenc (GPU NVIDIA)
  --chunk-frames N    taille max d'un morceau en images (défaut 90) : granularité du cache
  -o, --output F      fichier de sortie (défaut : out/<Titre>.mp4)`,
  options: renderOptions,
  run: step('render'),
};

export const make: Command = {
  name: 'make',
  summary: 'chaîne complète : voix (si clé) → timeline → musique → rendu',
  usage: `studio make <projet> [options de render]
Sans OPENROUTER_API_KEY, réutilise les voix en cache ou estime les durées.`,
  options: renderOptions,
  run: step('make'),
};
