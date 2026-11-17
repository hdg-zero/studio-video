/** Typed client of the `studio ui` API. */
import type {
  ActionKind,
  ActionOptions,
  ApiError,
  DoctorReport,
  JobInfo,
  ProjectDetail,
  ProjectSummary,
  VoiceSearchResult,
} from '../../cli/src/ui/protocol.js';

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({ error: res.statusText }))) as unknown;
  if (!res.ok) throw new RequestError(res.status, data as ApiError);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  projects: () => call<ProjectSummary[]>('GET', '/api/projects'),
  createProject: (name: string, title: string, vertical = false) =>
    call<{ name: string }>('POST', '/api/projects', { name, title, vertical }),
  project: (name: string) => call<ProjectDetail>('GET', `/api/projects/${enc(name)}`),
  saveCapsule: (name: string, capsule: unknown) =>
    call<ProjectDetail>('PUT', `/api/projects/${enc(name)}/capsule`, capsule),
  run: (name: string, kind: ActionKind, options: ActionOptions = {}) =>
    call<JobInfo>('POST', `/api/projects/${enc(name)}/jobs`, { kind, options }),
  cancel: (id: string) => call<undefined>('DELETE', `/api/jobs/${enc(id)}`),
  doctor: (refresh = false) => call<DoctorReport>('GET', `/api/doctor${refresh ? '?refresh=1' : ''}`),
  voices: (lang: string, query: string) =>
    call<VoiceSearchResult[]>('GET', `/api/voices?lang=${enc(lang)}&query=${enc(query)}`),
};

/** URL of a project file served under /files (deliverables, stills, mix, voice clips). */
export const fileUrl = (project: string, rel: string, version?: number): string =>
  `/files/${enc(project)}/${rel.split('/').map(enc).join('/')}${version ? `?v=${Math.round(version)}` : ''}`;

/** Path of `file` relative to the project root, as /files expects it. */
export const relativeTo = (root: string, file: string): string =>
  file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
