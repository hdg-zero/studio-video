/**
 * Live state pushed by the server (/api/events): jobs, log lines, and a version counter per
 * project that bumps whenever its files change, so views refetch only what they show.
 */
import { useEffect, useState } from 'preact/hooks';
import type { JobInfo, LogLine, ServerEvent } from '../../cli/src/ui/protocol.js';

export interface LiveState {
  readonly connected: boolean;
  readonly jobs: readonly JobInfo[];
  readonly logs: readonly LogLine[];
  readonly versions: Readonly<Record<string, number>>;
}

const MAX_LOGS = 1500;

let state: LiveState = { connected: false, jobs: [], logs: [], versions: {} };
const listeners = new Set<() => void>();

function set(next: Partial<LiveState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function apply(e: ServerEvent): void {
  switch (e.type) {
    case 'hello':
      set({ jobs: e.jobs, logs: e.logs });
      break;
    case 'job': {
      const i = state.jobs.findIndex((j) => j.id === e.job.id);
      const jobs = i < 0 ? [...state.jobs, e.job] : state.jobs.map((j, k) => (k === i ? e.job : j));
      set({ jobs });
      break;
    }
    case 'log': {
      const logs = [...state.logs, { jobId: e.jobId, level: e.level, msg: e.msg, time: e.time }];
      set({ logs: logs.length > MAX_LOGS ? logs.slice(-MAX_LOGS) : logs });
      break;
    }
    case 'project':
      set({ versions: { ...state.versions, [e.name]: (state.versions[e.name] ?? 0) + 1 } });
      break;
  }
}

/** Opens the event stream once; EventSource reconnects by itself after a server restart. */
export function connect(): void {
  const source = new EventSource('/api/events');
  source.onopen = () => set({ connected: true });
  source.onerror = () => set({ connected: false });
  source.onmessage = (m: MessageEvent<string>) => apply(JSON.parse(m.data) as ServerEvent);
}

/** Subscribes a component to a slice of the live state. */
export function useLive<T>(select: (s: LiveState) => T): T {
  const [value, setValue] = useState(() => select(state));
  useEffect(() => {
    const update = (): void => setValue(() => select(state));
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, [select]);
  return value;
}

export const selectJobs = (s: LiveState): readonly JobInfo[] => s.jobs;
export const selectLogs = (s: LiveState): readonly LogLine[] => s.logs;
export const selectConnected = (s: LiveState): boolean => s.connected;
export const selectVersions = (s: LiveState): Readonly<Record<string, number>> => s.versions;
