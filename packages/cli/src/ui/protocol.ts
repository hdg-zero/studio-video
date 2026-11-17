/**
 * Contract between `studio ui` and the web front-end (packages/ui): types only, imported by both
 * sides so a change on one side fails the type check of the other.
 */
import type { Timeline } from '@studio/runtime';
import type { Capsule } from '../core/config.js';
import type { ActionKind, ActionOptions, ActionResult } from '../core/actions.js';
import type { DoctorReport } from '../core/doctor.js';
import type { LogLevel, Progress } from '../core/log.js';
import type { MediaFile } from '../core/media.js';
import type { ProjectStatus, ProjectSummary } from '../core/status.js';
import type { VoiceSearchResult } from '../core/tts.js';

export type {
  MediaFile,
  ActionKind,
  ActionOptions,
  ActionResult,
  DoctorReport,
  LogLevel,
  Progress,
  ProjectStatus,
  ProjectSummary,
};
export type { Capsule, Timeline, VoiceSearchResult };
export type { Freshness, RenderFile, SegmentStatus } from '../core/status.js';

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobInfo {
  readonly id: string;
  readonly project: string;
  readonly kind: ActionKind;
  readonly options: ActionOptions;
  readonly state: JobState;
  readonly created: number;
  readonly started: number | null;
  readonly ended: number | null;
  readonly progress: Progress | null;
  readonly result: ActionResult | null;
  readonly error: string | null;
}

export interface LogLine {
  readonly jobId: string | null;
  readonly level: LogLevel;
  readonly msg: string;
  readonly time: number;
}

/** Messages of the `/api/events` stream. */
export type ServerEvent =
  | { readonly type: 'hello'; readonly jobs: readonly JobInfo[]; readonly logs: readonly LogLine[] }
  | { readonly type: 'job'; readonly job: JobInfo }
  | ({ readonly type: 'log' } & LogLine)
  /** Files of a project changed (a job finished, an edit, or a change made outside the UI). */
  | { readonly type: 'project'; readonly name: string };

/** `GET /api/projects/:name` */

export interface ProjectDetail {
  readonly status: ProjectStatus;
  /** capsule.json exactly as written on disk (without defaults filled in). */
  readonly capsule: Record<string, unknown>;
  /** The same capsule with every default filled in (what the render uses). */
  readonly resolved: Capsule;
  /** The timeline the capsule produces now (estimated where a clip is missing). */
  readonly timeline: Timeline;
  readonly estimated: readonly string[];
  /** Moods accepted by the music generator. */
  readonly moods: readonly string[];
  /** Pictures and clips of `media/`, usable in ready-made shots. */
  readonly media: readonly MediaFile[];
}

/** Error body of every failed API call. */
export interface ApiError {
  readonly error: string;
  /** Validation problems, by JSON path (e.g. `segments.3.text`). */
  readonly issues?: readonly { readonly path: string; readonly message: string }[];
}

export interface JobRequest {
  readonly kind: ActionKind;
  readonly options?: ActionOptions;
}

// ---------- assistant (OpenRouter) ----------

export type { ChatEvent } from '../ai/chat.js';
export type { ModelInfo, Usage } from '../ai/openrouter.js';

export type { SearchProvider } from '../ai/search.js';
import type { SearchProvider } from '../ai/search.js';

/** `GET /api/ai/status` */
export interface AiStatus {
  readonly available: boolean;
  readonly defaultModel: string | null;
  /** Web search providers whose key is set. */
  readonly search?: readonly SearchProvider[];
}

/** `POST /api/ai/chat` body (the answer is a stream of ChatEvent). */
export interface ChatRequestBody {
  readonly project: string;
  readonly model?: string;
  readonly messages: readonly {
    readonly role: 'user' | 'assistant';
    readonly content: string;
    readonly outcome?: 'applied' | 'pending' | 'undone';
  }[];
  readonly focus?: { readonly step?: string; readonly segment?: string };
  /** The last message is an interrupted answer to continue. */
  readonly resume?: boolean;
  /** Search the web before answering, with this provider. */
  readonly web?: SearchProvider;
}

import type { StudioEdit } from '../ai/edits.js';
export type { StudioEdit };
export type { Plan, PlannedScene } from '../ai/check.js';

/** `POST /api/ai/apply` body. */
export interface ApplyBody {
  readonly project: string;
  readonly plan: {
    readonly edits: readonly StudioEdit[];
    readonly scenes: readonly { readonly id: string; readonly code: string }[];
  };
  readonly update: boolean;
}

/** `POST /api/ai/apply` answer: the files written, the key to undo, the update job if asked. */
export interface ApplyResult {
  readonly undo: string;
  readonly files: readonly string[];
  readonly job: JobInfo | null;
}
