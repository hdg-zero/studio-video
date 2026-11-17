/** Commands that report state (for people and for agents with `--json`) and the web UI. */
import { color, log } from '../core/log.js';
import { loadProject } from '../core/project.js';
import { listProjects, projectStatus, type Freshness } from '../core/status.js';
import { formatBytes } from '../core/util.js';
import { startUi } from '../ui/server.js';
import { int, requireProject, str, type Command } from './types.js';

const MARK: Record<Freshness, string> = { fresh: color.green('✓'), stale: color.yellow('~'), missing: color.red('✗') };
const WORD: Record<Freshness, string> = { fresh: 'à jour', stale: 'à refaire', missing: 'absent' };

export const status: Command = {
  name: 'status',
  summary: 'état d’un projet : étapes à jour ou périmées, rendus, prochaine commande',
  usage: `studio status <projet> [--json]
Avec --json : objet complet (segments, voix, timeline, musique, planche, rendus, cache, next).`,
  options: {},
  async run(args, ctx) {
    const s = await projectStatus(await loadProject(requireProject(args)));
    if (ctx.json) return s;
    const out = (line: string): boolean => process.stdout.write(`${line}\n`);
    out(
      `${color.bold(s.title)} ${color.dim(`(${s.name}, ${s.duration.toFixed(1)} s, ${s.segments.length} segments)`)}`,
    );
    for (const seg of s.segments) {
      out(
        `  ${MARK[seg.voice]} ${seg.id.padEnd(16)} ${seg.mood.padEnd(10)} ${seg.dur.toFixed(1).padStart(5)} s  ${seg.scene ? '' : color.yellow('scène absente')}`,
      );
    }
    const step = (label: string, f: Freshness, extra = ''): boolean =>
      out(`${MARK[f]} ${label.padEnd(10)} ${WORD[f]}${extra ? color.dim(`  ${extra}`) : ''}`);
    step('voix', s.voice, s.apiKey ? '' : 'pas de clé OpenRouter');
    step('timeline', s.timeline.state);
    step('musique', s.music.state, s.music.mtime !== null && !s.music.withVoice ? 'sans voix' : '');
    step('planche', s.stills.state, s.stills.mtime !== null ? s.stills.file : '');
    for (const r of s.renders)
      out(`${r.stale ? MARK.stale : MARK.fresh} ${'rendu'.padEnd(10)} ${r.name} ${color.dim(formatBytes(r.size))}`);
    out(color.dim(`  cache : ${s.cache.chunks} morceaux, ${formatBytes(s.cache.bytes)}`));
    out(
      s.next
        ? `ensuite : ${color.cyan(s.next.command)}  ${color.dim(s.next.reason)}`
        : color.green('vidéo finale à jour'),
    );
    return s;
  },
};

export const projects: Command = {
  name: 'projects',
  summary: 'liste les projets',
  usage: 'studio projects [--json]',
  options: {},
  async run(_args, ctx) {
    const list = await listProjects();
    if (!ctx.json) {
      for (const p of list)
        process.stdout.write(
          `${p.name.padEnd(20)} ${p.error ? color.red('capsule.json invalide') : `${p.title} ${color.dim(`(${p.segments} segments)`)}`}\n`,
        );
    }
    return list;
  },
};

export const ui: Command = {
  name: 'ui',
  summary: 'interface web : écrire, lancer les étapes, prévisualiser, regarder les rendus',
  usage: `studio ui [--port 8123] [--host 127.0.0.1]
  --host   0.0.0.0 pour l'ouvrir depuis une autre machine du réseau (sans authentification)`,
  options: { port: { type: 'string' }, host: { type: 'string' } },
  async run(args, ctx) {
    const host = str(args.values.host) ?? '127.0.0.1';
    const server = await startUi({ port: int(args.values.port, 'port') ?? 8123, host });
    if (host !== '127.0.0.1' && host !== 'localhost')
      log.warn(`interface ouverte sur ${host} : toute machine du réseau peut lancer des rendus`);
    log.ok(`interface : ${server.url}  (Ctrl+C pour arrêter)`);
    await new Promise((resolve) => ctx.signal.addEventListener('abort', resolve, { once: true }));
    log.info('arrêt…');
    await server.close();
    return { url: server.url };
  },
};
