/** Utility commands: scaffolding, voice search, preview, verification, environment check. */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CapsuleSpec } from '../core/config.js';
import { diagnose, GPU_HELP } from '../core/doctor.js';
import { STUDIO_HOME } from '../core/home.js';
import { color, log } from '../core/log.js';
import { loadProject } from '../core/project.js';
import { servePreview } from '../core/preview.js';
import { createProject } from '../core/scaffold.js';
import { createShort, knownDurations, SHORT_MAX_SECONDS } from '../core/short.js';
import { checkVideo } from '../core/stills.js';
import { readManifest, searchVoices } from '../core/tts.js';
import { int, list, requireProject, str, type Command } from './types.js';

export const create: Command = {
  name: 'new',
  summary: 'crée un projet à partir du modèle',
  usage: `studio new <nom> [--title "Titre"] [--dir projects] [--vertical]
  --vertical   vidéo verticale courte : 1080×1920, amorce et générique courts, sous-titres mot par mot`,
  options: { title: { type: 'string' }, dir: { type: 'string' }, vertical: { type: 'boolean' } },
  async run(args) {
    const name = args.positionals[0];
    if (!name) throw new Error('usage: studio new <nom> (minuscules, chiffres, - et _)');
    const vertical = args.values.vertical === true;
    const root = await createProject(name, str(args.values.title), str(args.values.dir), { vertical });
    log.ok(`projet créé : ${root}${vertical ? ' (vertical 1080×1920)' : ''}`);
    log.info(`ensuite : écrire capsule.json et scenes/, puis \`studio make ${name} --draft\``);
    return { name, root, vertical };
  },
};

export const short: Command = {
  name: 'short',
  summary: "tire une vidéo verticale courte de quelques segments d'un projet",
  usage: `studio short <projet> --segments a,b,c [--name <nom>] [--title "Titre"] [--dir projects]
  Crée le projet <nom> (défaut : <projet>-court) en 1080×1920 avec les segments choisis, dans cet ordre.
  Scènes, médias et voix déjà générées sont copiés : pas de nouvelle voix à payer.
  Sans --segments : liste les segments du projet avec leur durée.`,
  options: {
    segments: { type: 'string' },
    name: { type: 'string' },
    title: { type: 'string' },
    dir: { type: 'string' },
  },
  async run(args, ctx) {
    const project = await loadProject(requireProject(args));
    const segments = list(args.values.segments);
    if (!segments?.length) {
      const durations = knownDurations(project.capsule, await readManifest(project));
      const rows = project.capsule.segments.map((s) => ({ id: s.id, dur: durations[s.id] ?? null, text: s.text }));
      if (!ctx.json) {
        for (const r of rows)
          process.stdout.write(
            `${r.id.padEnd(16)} ${r.dur === null ? '   ?  ' : `${r.dur.toFixed(1).padStart(5)} s`}  ${r.text.slice(0, 70)}\n`,
          );
        log.info(
          `choisir avec --segments ${rows
            .slice(0, 3)
            .map((r) => r.id)
            .join(',')} (l'ordre est respecté)`,
        );
      }
      return { segments: rows };
    }
    const r = await createShort(project, segments, {
      name: str(args.values.name),
      title: str(args.values.title),
      dir: str(args.values.dir),
    });
    log.ok(`projet créé : ${r.root} · ${segments.length} segment(s) · ~${Math.round(r.duration)} s`);
    if (r.duration > SHORT_MAX_SECONDS)
      log.warn(`plus de ${SHORT_MAX_SECONDS} s : certaines applications ne la traiteront pas comme une vidéo courte`);
    const missing = segments.filter((id) => !r.voices.includes(id));
    if (missing.length) log.warn(`voix à générer pour : ${missing.join(', ')} (studio tts ${r.name})`);
    log.info(`ensuite : \`studio stills ${r.name}\` pour vérifier le cadrage, puis \`studio make ${r.name}\``);
    return { name: r.name, root: r.root, duration: r.duration, estimated: r.estimated, voices: r.voices };
  },
};

export const voices: Command = {
  name: 'voices',
  summary: 'cherche une voix de narrateur fixe (bibliothèque publique Fish Audio)',
  usage: `studio voices [--lang fr] [--query narrat] [--n 20]
Évitez les voix qui imitent des personnes réelles ou des personnages.`,
  options: { lang: { type: 'string' }, query: { type: 'string' }, n: { type: 'string' } },
  async run(args, ctx) {
    const found = await searchVoices(
      str(args.values.lang) ?? 'fr',
      str(args.values.query) ?? '',
      int(args.values.n, 'n') ?? 20,
    );
    if (!ctx.json) {
      for (const v of found) {
        process.stdout.write(
          `${v.id} | ${v.title.slice(0, 40)} | ${v.languages.join(',')} | ${v.uses} usages | ${v.description}\n`,
        );
      }
    }
    return found;
  },
};

export const previewCmd: Command = {
  name: 'preview',
  summary: 'aperçu temps réel dans le navigateur, rechargé à chaque modification',
  usage: 'studio preview <projet> [--port 8124]',
  options: { port: { type: 'string' } },
  async run(args, ctx) {
    const server = await servePreview(await loadProject(requireProject(args)), int(args.values.port, 'port') ?? 8124);
    log.ok(`aperçu : ${server.url}  (Ctrl+C pour arrêter)`);
    await new Promise((resolve) => ctx.signal.addEventListener('abort', resolve, { once: true }));
    await server.close();
    return { url: server.url };
  },
};

export const check: Command = {
  name: 'check',
  summary: 'extrait des images de la vidéo finale (vérifier le fichier, pas la page)',
  usage: 'studio check <video.mp4> <t1> <t2> …',
  options: {},
  async run(args, ctx) {
    const [video, ...rest] = args.positionals;
    if (!video || rest.length === 0) throw new Error('usage: studio check <video.mp4> <t1> <t2> …');
    const file = await checkVideo(path.resolve(video), rest.map(Number));
    if (!ctx.json) log.ok(file);
    return { file };
  },
};

export const clean: Command = {
  name: 'clean',
  summary: 'supprime le cache (.studio) d’un projet',
  usage: 'studio clean <projet>',
  options: {},
  async run(args) {
    const project = await loadProject(requireProject(args));
    await rm(project.paths.work, { recursive: true, force: true });
    log.ok(`supprimé : ${project.paths.work}`);
    return { removed: project.paths.work };
  },
};

export const doctor: Command = {
  name: 'doctor',
  summary: 'vérifie l’installation (ffmpeg, Chromium, GPU, Python)',
  usage: `studio doctor [--refresh-gpu]
  --refresh-gpu   refait la détection du GPU (après une mise à jour de pilote)`,
  options: { 'refresh-gpu': { type: 'boolean' } },
  async run(args, ctx) {
    const report = await diagnose({ refreshGpu: Boolean(args.values['refresh-gpu']) });
    if (!ctx.json) {
      process.stdout.write(color.dim(`  ${report.cpuThreads} threads CPU\n`));
      for (const c of report.checks) {
        const mark = c.ok ? color.green('✓') : c.blocking ? color.red('✗') : color.yellow('!');
        process.stdout.write(`${mark} ${c.label}${c.detail ? color.dim(`  ${c.detail}`) : ''}\n`);
      }
      if (report.gpu && !report.gpu.hardware) process.stdout.write(color.dim(`  ${GPU_HELP}\n`));
      const failures = report.checks.filter((c) => !c.ok && c.blocking).length;
      if (failures) throw new Error(`${failures} problème(s) bloquant(s)`);
    }
    return report;
  },
};

export const schema: Command = {
  name: 'schema',
  summary: 'écrit schemas/capsule.schema.json (complétion et validation de capsule.json dans l’éditeur)',
  usage: 'studio schema',
  options: {},
  async run() {
    const file = path.join(STUDIO_HOME, 'schemas', 'capsule.schema.json');
    await mkdir(path.dirname(file), { recursive: true });
    const json = z.toJSONSchema(CapsuleSpec, { io: 'input', unrepresentable: 'any' });
    await writeFile(file, `${JSON.stringify(json, null, 2)}\n`);
    log.ok(file);
    return { file };
  },
};
