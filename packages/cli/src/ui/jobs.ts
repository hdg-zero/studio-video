/**
 * Job queue of the web UI. Jobs run one at a time: a render already uses every core, and
 * running steps of the same project concurrently would race on its files.
 */
import { randomUUID } from 'node:crypto';
import { runAction, type ActionKind, type ActionOptions } from '../core/actions.js';
import { log, onEvent } from '../core/log.js';
import { loadProject } from '../core/project.js';
import { isAbort } from '../core/util.js';
import type { JobInfo, LogLine, ServerEvent } from './protocol.js';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const KEEP_JOBS = 50;
const KEEP_LOGS = 2000;

export class JobQueue {
  readonly #jobs: Mutable<JobInfo>[] = [];
  readonly #logs: LogLine[] = [];
  #current: { job: Mutable<JobInfo>; controller: AbortController } | null = null;

  /**
   * @param emit receives every job update and log line
   * @param resolveProject maps a project name to its folder
   */
  constructor(
    private readonly emit: (e: ServerEvent) => void,
    private readonly resolveProject: (name: string) => string,
  ) {
    onEvent((e) => {
      const jobId = this.#current?.job.id ?? null;
      if (e.type === 'log') {
        const line: LogLine = { jobId, level: e.level, msg: e.msg, time: e.time };
        this.#logs.push(line);
        if (this.#logs.length > KEEP_LOGS) this.#logs.splice(0, this.#logs.length - KEEP_LOGS);
        this.emit({ type: 'log', ...line });
      } else if (this.#current) {
        const { task, done, total, rate, eta, unit } = e;
        this.#current.job.progress = { task, done, total, rate, eta, unit };
        this.#publish(this.#current.job);
      }
    });
  }

  list(): readonly JobInfo[] {
    return this.#jobs;
  }

  logs(): readonly LogLine[] {
    return this.#logs;
  }

  /** True while a job of this project is queued or running. */
  busy(project: string): boolean {
    return this.#jobs.some((j) => j.project === project && (j.state === 'queued' || j.state === 'running'));
  }

  submit(project: string, kind: ActionKind, options: ActionOptions = {}): JobInfo {
    const job: Mutable<JobInfo> = {
      id: randomUUID(),
      project,
      kind,
      options,
      state: 'queued',
      created: Date.now(),
      started: null,
      ended: null,
      progress: null,
      result: null,
      error: null,
    };
    this.#jobs.push(job);
    const finished = this.#jobs.filter((j) => j.ended !== null);
    for (const old of finished.slice(0, Math.max(0, finished.length - KEEP_JOBS)))
      this.#jobs.splice(this.#jobs.indexOf(old), 1);
    this.#publish(job);
    void this.#next();
    return job;
  }

  /** Cancels a queued job, or stops the running one (finished work stays cached). */
  cancel(id: string): boolean {
    const job = this.#jobs.find((j) => j.id === id);
    if (!job) return false;
    if (job.state === 'queued') {
      job.state = 'cancelled';
      job.ended = Date.now();
      this.#publish(job);
    } else if (this.#current?.job.id === id) {
      this.#current.controller.abort();
    }
    return true;
  }

  /** Stops everything (server shutdown). */
  async close(): Promise<void> {
    for (const j of this.#jobs) if (j.state === 'queued') this.cancel(j.id);
    const running = this.#current;
    if (!running) return;
    running.controller.abort();
    while (this.#current) await new Promise((r) => setTimeout(r, 50));
  }

  #publish(job: JobInfo): void {
    this.emit({ type: 'job', job: { ...job } });
  }

  async #next(): Promise<void> {
    if (this.#current) return;
    const job = this.#jobs.find((j) => j.state === 'queued');
    if (!job) return;
    const controller = new AbortController();
    this.#current = { job, controller };
    job.state = 'running';
    job.started = Date.now();
    this.#publish(job);
    log.step(`${job.kind} ${job.project}`);
    try {
      const project = await loadProject(this.resolveProject(job.project));
      job.result = await runAction(project, job.kind, job.options, controller.signal);
      job.state = 'done';
    } catch (err) {
      const cancelled = controller.signal.aborted || isAbort(err);
      job.state = cancelled ? 'cancelled' : 'failed';
      job.error = cancelled ? null : err instanceof Error ? err.message : String(err);
      if (cancelled) log.warn(`${job.kind} ${job.project} : annulé`);
      else log.error(job.error ?? 'erreur');
    } finally {
      job.ended = Date.now();
      this.#current = null;
      this.#publish(job);
      this.emit({ type: 'project', name: job.project });
    }
    void this.#next();
  }
}
