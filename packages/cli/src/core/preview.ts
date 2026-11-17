/**
 * Live preview: esbuild watches the scenes and the page reloads on every rebuild (server-sent
 * events) and whenever capsule.json or the voice clips change.
 *
 * The preview builds the timeline from the capsule and the clips on the fly (durations estimated
 * where a clip is missing), so an edited sentence shows up without running `studio timeline`.
 * It bundles into `.studio/preview/`, apart from the render bundle, so a preview never changes
 * the code a running render loads.
 */
import { mkdirSync, watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { bundleOptions } from './bundle.js';
import { parseCapsule } from './config.js';
import { log } from './log.js';
import { mediaMounts, resolveVisuals } from './media.js';
import { renderPage } from './page.js';
import type { Project } from './project.js';
import { bundleHandler, EventHub, listen, urlPathOf } from './server.js';
import { computeTimeline } from './steps.js';

export class PreviewSession {
  readonly #watchers: FSWatcher[] = [];
  #page = '';
  #timer: NodeJS.Timeout | undefined;
  #handler: ReturnType<typeof bundleHandler>;

  private constructor(
    private project: Project,
    private readonly ctx: esbuild.BuildContext,
    private readonly reload: EventHub,
    readonly dir: string,
  ) {
    this.#handler = bundleHandler(dir, () => this.#page, reload, mediaMounts(project));
  }

  static async open(project: Project): Promise<PreviewSession> {
    const dir = path.join(project.paths.work, 'preview');
    const reload = new EventHub();
    const ctx = await esbuild.context({
      ...bundleOptions(project),
      outdir: dir,
      minify: false,
      plugins: [
        {
          name: 'studio-reload',
          setup(build) {
            build.onEnd((r) => {
              if (r.errors.length) {
                log.error(`aperçu : ${r.errors.map((e) => e.text).join('; ')}`);
                return;
              }
              log.debug(`aperçu ${project.name} : scènes reconstruites`);
              reload.send('reload');
            });
          },
        },
      ],
    });
    const session = new PreviewSession(project, ctx, reload, dir);
    await session.#refresh();
    await ctx.watch();
    session.#watch();
    return session;
  }

  /** Serves a request whose path is relative to the preview root (`/`, `/bundle.js`…). */
  handle(req: http.IncomingMessage, res: http.ServerResponse, urlPath: string): Promise<void> {
    return this.#handler(req, res, urlPath);
  }

  async dispose(): Promise<void> {
    clearTimeout(this.#timer);
    for (const w of this.#watchers) w.close();
    this.reload.close();
    await this.ctx.dispose();
  }

  #watch(): void {
    const { paths } = this.project;
    mkdirSync(paths.voice, { recursive: true });
    // watch the folders, not the files: atomic writes replace the file (new inode)
    const on = (dir: string, name: string): void => {
      this.#watchers.push(
        watch(dir, (_event, file) => {
          if (file === name) this.#debounce();
        }),
      );
    };
    on(paths.root, 'capsule.json');
    on(paths.voice, 'manifest.json');
    mkdirSync(paths.media, { recursive: true });
    this.#watchers.push(watch(paths.media, () => this.#debounce()));
  }

  #debounce(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      void this.#refresh().then(() => this.reload.send('reload'));
    }, 150);
  }

  async #refresh(): Promise<void> {
    try {
      const { paths } = this.project;
      const capsule = parseCapsule(JSON.parse(await readFile(paths.capsule, 'utf8')), paths.capsule);
      this.project = { ...this.project, capsule };
      const { timeline } = await computeTimeline(this.project);
      // a missing picture leaves its shot out of the preview instead of breaking it
      const { visuals, problems } = await resolveVisuals(this.project);
      problems.forEach((p) => log.warn(`aperçu ${this.project.name} : ${p}`));
      this.#page = renderPage(capsule, timeline, { liveReload: true, visuals });
    } catch (err) {
      // keep showing the last valid page; the editor reports the validation error
      log.warn(`aperçu ${this.project.name} : ${(err as Error).message}`);
    }
  }
}

/** `studio preview`: one project on a fixed port. */
export async function servePreview(project: Project, port: number): Promise<{ url: string; close(): Promise<void> }> {
  const session = await PreviewSession.open(project);
  const srv = await listen((req, res) => session.handle(req, res, urlPathOf(req)), port);
  return {
    url: srv.url,
    close: async () => {
      await session.dispose();
      await srv.close();
    },
  };
}
