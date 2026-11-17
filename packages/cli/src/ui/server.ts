/**
 * `studio ui`: a local web app over the same core as the CLI.
 *
 *   /api/…              JSON API (projects, capsule and scene editing, jobs, diagnosis) + /api/events (SSE)
 *   /api/ai/…           the assistant (OpenRouter): models, streamed chat with the project as context
 *   /files/<project>/…  deliverables and previews (videos with byte ranges, stills, mix, voice clips)
 *   /preview/<project>/ live preview page (esbuild watch), embedded by the front-end
 *   /…                  the front-end (packages/ui/dist)
 *
 * Listens on 127.0.0.1 by default and only answers requests addressed to the host it serves,
 * so a web page elsewhere cannot drive it (DNS rebinding, cross-site POST).
 *
 * This file routes; HTTP helpers are in http.ts, project files (media import, voice clips) in
 * files.ts, the file watcher in watch.ts.
 */
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import { z } from 'zod';
import { applyPlan, PlanRejected, undoPlan } from '../ai/apply.js';
import { ChatRequestSpec, streamChat } from '../ai/chat.js';
import { EditSpec } from '../ai/check.js';
import { aiAvailable, defaultModel, listModels } from '../ai/openrouter.js';
import { searchProviders } from '../ai/search.js';
import { ACTIONS, CODECS, GPU_MODES } from '../core/actions.js';
import { CapsuleSpec, MOODS } from '../core/config.js';
import { diagnose, type DoctorReport } from '../core/doctor.js';
import { STUDIO_HOME } from '../core/home.js';
import { log } from '../core/log.js';
import { listMedia } from '../core/media.js';
import { loadProject, projectPaths } from '../core/project.js';
import { PreviewSession } from '../core/preview.js';
import { createProject, PROJECT_NAME } from '../core/scaffold.js';
import { readScene } from '../core/scenes.js';
import { EventHub, listen, resolveInside, sendFile } from '../core/server.js';
import { computeTimeline } from '../core/steps.js';
import { listProjects, projectStatus, projectsRoot } from '../core/status.js';
import { searchVoices } from '../core/tts.js';
import { writeFileAtomic } from '../core/util.js';
import { READABLE, saveMedia, sendClip } from './files.js';
import { checkOrigin, HttpError, json, parse, readJson } from './http.js';
import { JobQueue } from './jobs.js';
import type { ProjectDetail, ServerEvent } from './protocol.js';
import { watchProjects } from './watch.js';

const UI_DIST = path.join(STUDIO_HOME, 'packages', 'ui', 'dist');

const JobRequestSpec = z.object({
  kind: z.enum(ACTIONS),
  options: z
    .object({
      only: z.array(z.string()).optional(),
      force: z.boolean().optional(),
      check: z.boolean().optional(),
      estimate: z.boolean().optional(),
      noVoice: z.boolean().optional(),
      times: z.array(z.number().nonnegative()).optional(),
      draft: z.boolean().optional(),
      gpu: z.enum(GPU_MODES).optional(),
      codec: z.enum(CODECS).optional(),
      workers: z.number().int().positive().max(64).optional(),
      chunkFrames: z.number().int().positive().optional(),
    })
    .strict()
    .default({}),
});

const ApplySpec = z.object({
  project: z.string(),
  plan: z.object({
    edits: z.array(EditSpec).max(300),
    scenes: z.array(z.object({ id: z.string(), code: z.string().min(1).max(500_000) })).max(30),
  }),
  /** Then bring the video up to date (voices, timeline, music, 720p draft). */
  update: z.boolean().default(false),
});
const UndoSpec = z.object({ project: z.string(), undo: z.uuid() });

const NewProjectSpec = z.object({
  name: z.string().regex(PROJECT_NAME),
  title: z.string().min(1).optional(),
  /** Vertical short video (1080x1920). */
  vertical: z.boolean().optional(),
});

export interface UiServer {
  readonly url: string;
  close(): Promise<void>;
}

export interface UiOptions {
  readonly port: number;
  readonly host: string;
}

export async function startUi(opts: UiOptions): Promise<UiServer> {
  const root = projectsRoot();
  const events = new EventHub();
  const emit = (e: ServerEvent): void => events.send(JSON.stringify(e));
  const dirOf = (name: string): string => {
    if (!PROJECT_NAME.test(name)) throw new HttpError(400, `invalid project name "${name}"`);
    const dir = path.join(root, name);
    if (!existsSync(path.join(dir, 'capsule.json'))) throw new HttpError(404, `no project "${name}"`);
    return dir;
  };
  const jobs = new JobQueue(emit, dirOf);
  const previews = new Map<string, PreviewSession>();
  let doctorCache: Promise<DoctorReport> | null = null;
  const watcher = watchProjects(root, (name) => emit({ type: 'project', name }));

  const api = async (req: http.IncomingMessage, res: http.ServerResponse, parts: string[]): Promise<void> => {
    const method = req.method ?? 'GET';
    const [resource, name, sub] = parts;
    const route = `${method} ${[resource, name && ':name', sub].filter(Boolean).join('/')}${parts.length > 3 ? '/…' : ''}`;
    switch (route) {
      case 'GET events':
        events.attach(req, res, JSON.stringify({ type: 'hello', jobs: jobs.list(), logs: jobs.logs().slice(-500) }));
        return;
      case 'GET projects':
        return json(res, await listProjects(root));
      case 'POST projects': {
        const body = parse(NewProjectSpec, await readJson(req));
        await createProject(body.name, body.title, root, { vertical: body.vertical === true });
        emit({ type: 'project', name: body.name });
        return json(res, { name: body.name }, 201);
      }
      case 'GET projects/:name':
        return json(res, await detail(dirOf(name ?? '')));
      case 'PUT projects/:name/capsule': {
        const dir = dirOf(name ?? '');
        const raw = await readJson(req);
        parse(CapsuleSpec, raw);
        await writeFileAtomic(path.join(dir, 'capsule.json'), `${JSON.stringify(raw, null, 2)}\n`);
        return json(res, await detail(dir));
      }
      case 'POST projects/:name/media': {
        // raw body, file name in the query: no multipart parsing
        const dir = dirOf(name ?? '');
        const wanted = new URL(req.url ?? '/', 'http://x').searchParams.get('name') ?? '';
        const file = await saveMedia(projectPaths(dir).media, wanted, req);
        emit({ type: 'project', name: name ?? '' });
        return json(res, { name: file }, 201);
      }
      case 'POST projects/:name/jobs': {
        dirOf(name ?? '');
        const body = parse(JobRequestSpec, await readJson(req));
        return json(res, jobs.submit(name ?? '', body.kind, body.options), 202);
      }
      case 'GET jobs':
        return json(res, jobs.list());
      case 'DELETE jobs/:name':
        if (!jobs.cancel(name ?? '')) throw new HttpError(404, 'no such job');
        res.writeHead(204).end();
        return;
      case 'GET doctor': {
        const refresh = new URL(req.url ?? '/', 'http://x').searchParams.has('refresh');
        if (refresh || !doctorCache) doctorCache = diagnose({ refreshGpu: refresh });
        return json(res, await doctorCache);
      }
      case 'GET voices': {
        const q = new URL(req.url ?? '/', 'http://x').searchParams;
        return json(res, await searchVoices(q.get('lang') ?? 'fr', q.get('query') ?? '', 30));
      }
      case 'GET projects/:name/scenes/…': {
        const project = await loadProject(dirOf(name ?? ''));
        return json(res, { id: parts[3], code: await readScene(project, parts[3] ?? '') });
      }
      case 'GET ai/:name':
        if (name === 'status') {
          const available = aiAvailable();
          const models = available ? await listModels().catch(() => []) : [];
          return json(res, {
            available,
            defaultModel: available ? defaultModel(models) : null,
            search: searchProviders(),
          });
        }
        if (name === 'models') return json(res, await listModels());
        throw new HttpError(404, `no route ${route}`);
      case 'POST ai/:name': {
        if (name === 'apply') {
          const body = parse(ApplySpec, await readJson(req));
          const project = await loadProject(dirOf(body.project));
          try {
            const applied = await applyPlan(project, body.plan);
            const job = body.update ? jobs.submit(body.project, 'make', { draft: true }) : null;
            return json(res, { ...applied, job });
          } catch (err) {
            if (err instanceof PlanRejected) throw new HttpError(409, err.message);
            throw err;
          }
        }
        if (name === 'undo') {
          const body = parse(UndoSpec, await readJson(req));
          const project = await loadProject(dirOf(body.project));
          return json(res, {
            files: await undoPlan(project, body.undo).catch((err: unknown) => {
              throw new HttpError(409, err instanceof Error ? err.message : String(err));
            }),
          });
        }
        if (name !== 'chat') throw new HttpError(404, `no route ${route}`);
        if (!aiAvailable())
          throw new HttpError(
            503,
            'pas de clé OpenRouter : lancer `studio ui` depuis un terminal où OPENROUTER_API_KEY est définie',
          );
        const raw = (await readJson(req)) as { project?: unknown };
        const project = await loadProject(dirOf(typeof raw.project === 'string' ? raw.project : ''));
        return streamChat(res, project, parse(ChatRequestSpec, raw));
      }
      default:
        throw new HttpError(404, `no route ${route}`);
    }
  };

  const files = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    name: string,
    rel: string,
  ): Promise<void> => {
    const dir = dirOf(name);
    const voice = /^voice\/([a-z0-9][a-z0-9_-]*)\.wav$/.exec(rel);
    if (voice) return sendClip(res, path.join(projectPaths(dir).voice, `${voice[1] ?? ''}.pcm`));
    if (!READABLE.some((r) => r.test(rel))) throw new HttpError(403, 'not a deliverable');
    const file = resolveInside(dir, rel);
    if (!file) throw new HttpError(403, 'outside the project');
    return sendFile(req, res, file);
  };

  const preview = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    name: string,
    rest: string,
  ): Promise<void> => {
    let session = previews.get(name);
    if (!session) {
      session = await PreviewSession.open(await loadProject(dirOf(name)));
      previews.set(name, session);
      // keep the three most recent previews (each one is an esbuild watcher)
      for (const [old, s] of [...previews].slice(0, -3)) {
        previews.delete(old);
        void s.dispose();
      }
    }
    return session.handle(req, res, rest || '/');
  };

  const allowedHosts = new Set<string>();
  const srv = await listen(
    async (req, res) => {
      try {
        checkOrigin(req, allowedHosts);
        const url = new URL(req.url ?? '/', 'http://x');
        const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        const [head, name, ...rest] = segments;
        if (head === 'api') return await api(req, res, segments.slice(1));
        if (head === 'files' && name) return await files(req, res, name, rest.join('/'));
        if (head === 'preview' && name) {
          if (!url.pathname.endsWith('/') && rest.length === 0) {
            res.writeHead(301, { location: `${url.pathname}/${url.search}` }).end();
            return;
          }
          return await preview(req, res, name, `/${rest.join('/')}`);
        }
        // front-end: static files, and index.html for client-side routes
        const file = resolveInside(UI_DIST, url.pathname);
        const target =
          file && existsSync(file) && (await stat(file)).isFile() ? file : path.join(UI_DIST, 'index.html');
        if (!existsSync(target)) throw new HttpError(500, 'UI not built: run `npm run build`');
        return await sendFile(req, res, target, target.endsWith('index.html') ? 'no-store' : 'max-age=3600');
      } catch (err) {
        const e = err instanceof HttpError ? err : new HttpError(500, err instanceof Error ? err.message : String(err));
        if (e.status >= 500) log.error(`ui : ${e.message}`);
        if (!res.headersSent) json(res, { error: e.message, ...(e.issues ? { issues: e.issues } : {}) }, e.status);
        else res.end();
      }
    },
    opts.port,
    opts.host,
  );
  const port = new URL(srv.url).port;
  for (const h of [opts.host, 'localhost', '127.0.0.1', '[::1]']) allowedHosts.add(`${h}:${port}`);

  return {
    url: srv.url,
    close: async () => {
      watcher?.close();
      await jobs.close();
      await Promise.all([...previews.values()].map((p) => p.dispose()));
      events.close();
      await srv.close();
    },
  };
}

async function detail(dir: string): Promise<ProjectDetail> {
  const project = await loadProject(dir);
  const { timeline, estimated } = await computeTimeline(project);
  return {
    status: await projectStatus(project),
    capsule: JSON.parse(await readFile(project.paths.capsule, 'utf8')) as Record<string, unknown>,
    resolved: project.capsule,
    timeline,
    estimated,
    moods: MOODS,
    media: await listMedia(project),
  };
}
