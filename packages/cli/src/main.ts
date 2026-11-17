/**
 * `studio` command-line entry point: dispatches to one command per pipeline step.
 * Argument parsing uses node:util `parseArgs` (no dependency, instant startup).
 *
 * Global flags: `--verbose` (debug log), `--json` (print the command's result as JSON on stdout;
 * human messages stay on stderr). Ctrl+C aborts the running step cleanly; a second one exits.
 */
import { parseArgs } from 'node:util';
import { projects, status, ui } from './commands/inspect.js';
import { check, clean, create, doctor, previewCmd, schema, short, voices } from './commands/misc.js';
import { make, music, renderCmd, stills, timeline, tts, voicecheck } from './commands/pipeline.js';
import type { Command } from './commands/types.js';
import { color, log, setVerbose } from './core/log.js';
import { isAbort } from './core/util.js';

const COMMANDS: readonly Command[] = [
  create,
  short,
  projects,
  status,
  tts,
  voices,
  voicecheck,
  timeline,
  music,
  stills,
  previewCmd,
  renderCmd,
  make,
  check,
  clean,
  doctor,
  schema,
  ui,
];

function help(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  return `${color.bold('studio')} : capsules vidéo narrées (Three.js, voix off, musique, sous-titres)

Usage : studio <commande> [arguments] [--json] [--verbose]

${COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`).join('\n')}

Chaîne habituelle : new → (capsule.json + scenes/) → tts → timeline → music → stills → render
\`studio status <projet>\` indique la prochaine étape. \`studio ui\` ouvre l'interface web.
\`studio help <commande>\` pour le détail. Documentation : docs/README.md`;
}

async function main(argv: string[], signal: AbortSignal): Promise<{ json: boolean; result: unknown }> {
  const [name, ...rest] = argv;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    const target = COMMANDS.find((c) => c.name === rest[0]);
    process.stdout.write(`${target ? target.usage : help()}\n`);
    return { json: false, result: undefined };
  }
  const command = COMMANDS.find((c) => c.name === name);
  if (!command) throw new Error(`unknown command "${name}"\n\n${help()}`);
  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(`${command.usage}\n`);
    return { json: false, result: undefined };
  }
  const { values, positionals } = parseArgs({
    args: rest,
    options: { ...command.options, verbose: { type: 'boolean', short: 'v' }, json: { type: 'boolean' } },
    allowPositionals: true,
    strict: true,
  });
  setVerbose(Boolean(values.verbose));
  const json = Boolean(values.json);
  return { json, result: await command.run({ values, positionals }, { signal, json }) };
}

const controller = new AbortController();
const onSignal = (): void => {
  if (controller.signal.aborted) process.exit(130);
  log.warn('arrêt demandé : fin propre en cours (Ctrl+C à nouveau pour forcer)');
  controller.abort();
};
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

const argv = process.argv.slice(2);
const wantsJson = argv.includes('--json');
main(argv, controller.signal)
  .then(({ json, result }) => {
    if (json) process.stdout.write(`${JSON.stringify(result ?? { ok: true }, null, 2)}\n`);
  })
  .catch((err: unknown) => {
    const message = isAbort(err) ? 'interrompu' : err instanceof Error ? err.message : String(err);
    log.error(message);
    if (process.env.STUDIO_DEBUG && err instanceof Error) process.stderr.write(`${err.stack}\n`);
    if (wantsJson) process.stdout.write(`${JSON.stringify({ error: message })}\n`);
    process.exitCode = isAbort(err) ? 130 : 1;
  });
