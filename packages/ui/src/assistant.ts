/**
 * Assistant client: conversations per project (kept in this browser), the streamed request,
 * and the proposals found in an answer (`studio-edits` and `scene:<id>` blocks, see ai/prompt.ts).
 */
import { useEffect, useState } from 'preact/hooks';
import type {
  ApplyResult,
  ChatEvent,
  ChatRequestBody,
  Plan,
  SearchProvider,
  Usage,
} from '../../cli/src/ui/protocol.js';

export interface Message {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /** Short label shown instead of a long generated prompt (quick actions). */
  readonly display?: string;
  readonly model?: string;
  readonly usage?: Usage | null;
  readonly error?: string;
  /** Messages shown while waiting (retry, continuation). */
  readonly notices?: readonly string[];
  /** Automatic correction rounds: the errors the studio sent back. */
  readonly repairs?: readonly (readonly string[])[];
  /** Checked proposal, ready to validate. */
  readonly plan?: Plan;
  /** Errors left after the corrections (nothing to validate). */
  readonly invalid?: readonly string[];
  /** The plan was applied (with the key to undo it), or applied then undone. */
  readonly applied?: { readonly undo: string } | 'undone';
  /** Still being written, or cut before its end (closed page, lost connection, stop): can be resumed. */
  readonly partial?: boolean;
}

interface Conversation {
  readonly messages: readonly Message[];
  readonly streaming: boolean;
}

const conversations = new Map<string, Conversation>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
const KEY = (project: string): string => `studio.chat.${project}`;

function load(project: string): Conversation {
  const known = conversations.get(project);
  if (known) return known;
  let messages: Message[] = [];
  try {
    const saved = localStorage.getItem(KEY(project));
    if (saved) messages = JSON.parse(saved) as Message[];
  } catch {
    // private window or blocked storage: start empty
  }
  const c = { messages, streaming: false };
  conversations.set(project, c);
  return c;
}

let savedAt = 0;

function update(project: string, fn: (c: Conversation) => Conversation): void {
  const next = fn(load(project));
  conversations.set(project, next);
  // saved while an answer is written too (every 1.5 s): a reload or a crash keeps what was received
  if (!next.streaming || Date.now() - savedAt > 1500) {
    savedAt = Date.now();
    try {
      localStorage.setItem(KEY(project), JSON.stringify(next.messages.slice(-40)));
    } catch {
      // storage full or blocked: the conversation stays in memory
    }
  }
  for (const l of listeners) l();
}

export function useConversation(project: string): Conversation {
  const [c, setC] = useState(() => load(project));
  useEffect(() => {
    const on = (): void => setC(load(project));
    listeners.add(on);
    on();
    return () => {
      listeners.delete(on);
    };
  }, [project]);
  return c;
}

export function clearConversation(project: string): void {
  controllers.get(project)?.abort();
  update(project, () => ({ messages: [], streaming: false }));
}

export function stop(project: string): void {
  controllers.get(project)?.abort();
}

function setApplied(project: string, messageIndex: number, applied: Message['applied']): void {
  update(project, (c) => ({
    ...c,
    messages: c.messages.map((m, i) => (i === messageIndex ? { ...m, ...(applied ? { applied } : {}) } : m)),
  }));
}

export interface SendOptions {
  readonly model?: string | undefined;
  /** Search the web before answering, with this provider. */
  readonly web?: SearchProvider | undefined;
  readonly focus?: { step?: string; segment?: string };
  readonly display?: string;
}

/** Sends a user message and streams the answer into the conversation. */
export async function send(project: string, content: string, opts: SendOptions = {}): Promise<void> {
  if (load(project).streaming) return;
  const user: Message = { role: 'user', content, ...(opts.display ? { display: opts.display } : {}) };
  update(project, (c) => ({
    messages: [...c.messages, user, { role: 'assistant', content: '', partial: true }],
    streaming: true,
  }));
  await stream(project, load(project).messages.slice(0, -1), opts, false);
}

/** Continues the last answer where it stopped: what was received is kept, the model writes the rest. */
export async function resume(project: string, opts: SendOptions = {}): Promise<void> {
  const c = load(project);
  const last = c.messages.at(-1);
  if (c.streaming || last?.role !== 'assistant' || !last.partial) return;
  const rest = { ...last };
  delete rest.error;
  update(project, (cur) => ({ messages: [...cur.messages.slice(0, -1), rest], streaming: true }));
  await stream(project, load(project).messages, opts, true);
}

/** What is sent to the server: the last messages, with the fate of earlier proposals. */
const history = (messages: readonly Message[]): ChatRequestBody['messages'] =>
  messages
    .filter((m) => !m.error || m.content)
    .slice(-12)
    .map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.role === 'assistant' && m.plan
        ? {
            outcome:
              m.applied === 'undone' ? ('undone' as const) : m.applied ? ('applied' as const) : ('pending' as const),
          }
        : {}),
    }));

async function stream(
  project: string,
  messages: readonly Message[],
  opts: SendOptions,
  resuming: boolean,
): Promise<void> {
  const controller = new AbortController();
  controllers.set(project, controller);
  const patchLast = (fn: (m: Message) => Message): void =>
    update(project, (c) => ({ ...c, messages: [...c.messages.slice(0, -1), fn(c.messages.at(-1) as Message)] }));

  try {
    const body: ChatRequestBody = {
      project,
      messages: history(messages),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.focus ? { focus: opts.focus } : {}),
      ...(resuming ? { resume: true } : {}),
      ...(opts.web && !resuming ? { web: opts.web } : {}),
    };
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
      throw new Error(err.error);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (!frame.startsWith('data: ')) continue;
        const e = JSON.parse(frame.slice(6)) as ChatEvent;
        switch (e.type) {
          case 'start':
          case 'model':
            patchLast((m) => ({ ...m, model: e.model }));
            break;
          case 'delta':
            patchLast((m) => ({ ...m, content: m.content + e.text }));
            break;
          case 'notice':
            patchLast((m) => ({ ...m, notices: [...(m.notices ?? []), e.message] }));
            break;
          case 'repair':
            // the correction is appended to the same answer, after a separator
            patchLast((m) => ({ ...m, content: `${m.content}\n\n`, repairs: [...(m.repairs ?? []), e.errors] }));
            break;
          case 'plan':
            patchLast((m) => ({ ...m, plan: e.plan }));
            break;
          case 'invalid':
            patchLast((m) => ({ ...m, invalid: e.errors }));
            break;
          case 'done':
            patchLast((m) => {
              const done = { ...m, usage: e.usage };
              delete done.partial;
              return done;
            });
            break;
          case 'error':
            patchLast((m) => ({ ...m, error: e.message }));
        }
      }
    }
  } catch (err) {
    if (!controller.signal.aborted)
      patchLast((m) => ({ ...m, error: err instanceof Error ? err.message : String(err) }));
  } finally {
    controllers.delete(project);
    update(project, (c) => ({ ...c, streaming: false }));
  }
}

// ---------- applying ----------

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({ error: res.statusText }))) as T | { error: string };
  if (!res.ok) throw new Error((data as { error: string }).error);
  return data as T;
}

/** Writes a checked plan to the project; `update` then queues voices, music and a draft render. */
export async function applyPlan(
  project: string,
  messageIndex: number,
  plan: Plan,
  update: boolean,
): Promise<ApplyResult> {
  const result = await post<ApplyResult>('/api/ai/apply', {
    project,
    plan: { edits: plan.edits, scenes: plan.scenes.map((s) => ({ id: s.id, code: s.code })) },
    update,
  });
  setApplied(project, messageIndex, { undo: result.undo });
  return result;
}

export async function undoPlan(project: string, messageIndex: number, undo: string): Promise<void> {
  await post('/api/ai/undo', { project, undo });
  setApplied(project, messageIndex, 'undone');
}

/** Asks the open project's assistant from anywhere in the page (error messages, job dock). */
export function askAssistant(project: string, prompt: string, display: string, segment?: string): void {
  window.dispatchEvent(new CustomEvent('studio:ask', { detail: { project, prompt, display, segment } }));
}

/** An error message as sent to the model: short, the end is usually where the cause is. */
export const errorExcerpt = (text: string, max = 1500): string => (text.length <= max ? text : `…${text.slice(-max)}`);
