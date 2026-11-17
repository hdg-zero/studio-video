/**
 * The assistant's HTTP endpoint. One request = one answer, streamed as SSE, then checked:
 *
 *   stream the answer ─▶ blocks? ─no─▶ done
 *                          │yes
 *                          ▼
 *                 check (capsule schema, bundle, types) ─ok─▶ `plan` (validation card)
 *                          │errors
 *                          ▼
 *        errors sent back to the model, which answers with corrected blocks (2 rounds at most)
 *
 * An answer cut by the token limit is continued. Token use: the stable part of the prompt comes
 * first and is marked for caching, the project is described compactly, and earlier answers are
 * sent back without their code (the current files are in the prompt).
 */
import type http from 'node:http';
import { z } from 'zod';
import { log } from '../core/log.js';
import type { Project } from '../core/project.js';
import { compactAnswer, isBlock, parseAnswer } from './blocks.js';
import { absorb, emptyProposal, hasProposal, planIsEmpty, verify, type Plan } from './check.js';
import {
  addUsage,
  chatStream,
  defaultModel,
  explicitCache,
  listModels,
  type ChatMessage,
  type TextPart,
  type Usage,
} from './openrouter.js';
import { SEARCH_LABELS, SEARCH_PROVIDERS, searchContext, webSearch, type SearchProvider } from './search.js';
import { CONTINUE_PROMPT, mentionedSegments, projectPrompt, repairPrompt, stablePrompt } from './prompt.js';

export const ChatRequestSpec = z.object({
  model: z.string().min(1).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(200_000),
        /** What became of an earlier answer's proposal. */
        outcome: z.enum(['applied', 'pending', 'undone']).optional(),
      }),
    )
    .min(1)
    .max(200),
  focus: z.object({ step: z.string().max(40).optional(), segment: z.string().max(80).optional() }).default({}),
  /** The last message is an answer that was interrupted: continue it instead of answering anew. */
  resume: z.boolean().default(false),
  /** Search the web before answering, with this provider (`true`: OpenRouter's plugin). See search.ts. */
  web: z.union([z.boolean(), z.enum(SEARCH_PROVIDERS)]).default(false),
});
export type ChatRequest = z.infer<typeof ChatRequestSpec>;

/** Events of the chat stream (see packages/cli/src/ui/protocol.ts). */
export type ChatEvent =
  | { readonly type: 'start'; readonly model: string }
  /** The model that actually answers, when OpenRouter fell back to another one. */
  | { readonly type: 'model'; readonly model: string }
  | { readonly type: 'delta'; readonly text: string }
  /** Something the user should know while waiting (retry, continuation). */
  | { readonly type: 'notice'; readonly message: string }
  /** The checks failed; the model is asked to correct (`round` of `MAX_REPAIRS`). */
  | { readonly type: 'repair'; readonly round: number; readonly errors: readonly string[] }
  /** Checked proposal, ready for the validation button. */
  | { readonly type: 'plan'; readonly plan: Plan }
  /** Still failing after the corrections: shown, not applicable. */
  | { readonly type: 'invalid'; readonly errors: readonly string[] }
  | { readonly type: 'done'; readonly usage: Usage | null }
  | { readonly type: 'error'; readonly message: string };

const MAX_REPAIRS = 2;
const MAX_CONTINUATIONS = 2;
/** Earlier messages sent back to the model. */
const HISTORY = 12;

export async function streamChat(res: http.ServerResponse, project: Project, body: ChatRequest): Promise<void> {
  const controller = new AbortController();
  // the browser closed the stream (stop button, page left): stop paying for tokens
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  const send = (e: ChatEvent): void => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  // in an object: assigned from the nested function below
  const total: { usage: Usage | null } = { usage: null };
  try {
    // only the chosen model answers: no automatic switch to another one
    const model = body.model ?? defaultModel(await listModels().catch(() => []));
    send({ type: 'start', model });

    // resuming an interrupted answer: it is the last message, sent back as is
    const resumedMessage = body.resume ? body.messages.at(-1) : undefined;
    const resumed = resumedMessage?.role === 'assistant' ? resumedMessage.content : '';
    const asked = resumed ? body.messages.slice(0, -1) : body.messages;
    const last = asked.at(-1)?.content ?? '';
    const focus = { ...body.focus, mentions: mentionedSegments(project, last) };
    const system = systemMessage(model, await stablePrompt(), await projectPrompt(project, focus));
    const messages: ChatMessage[] = [system, ...history(asked)];

    // one search per question: continuations and corrections reuse what was found
    const provider: SearchProvider | null = resumed || !body.web ? null : body.web === true ? 'openrouter' : body.web;
    if (provider && provider !== 'openrouter') {
      send({ type: 'notice', message: `recherche web (${SEARCH_LABELS[provider]})…` });
      try {
        const found = await webSearch(provider, last, project.capsule.language, controller.signal);
        const question = messages.at(-1);
        if (question?.role === 'user' && typeof question.content === 'string')
          messages[messages.length - 1] = {
            role: 'user',
            content: `${searchContext(provider, found)}\n\nQuestion : ${question.content}`,
          };
      } catch (err) {
        if (controller.signal.aborted) throw err;
        // the answer comes without the web rather than not at all
        send({
          type: 'notice',
          message: `${err instanceof Error ? err.message : String(err)} : réponse sans recherche web`,
        });
      }
    }

    /**
     * One model call, continued when the answer is cut (token limit, connection lost after some
     * text: what was received is kept and the model asked for the rest); returns the round's text.
     */
    let web = provider === 'openrouter';
    const ask = async (start = ''): Promise<string> => {
      let text = start;
      for (let part = start ? 1 : 0; ; part++) {
        let finish = '';
        const search = web;
        web = false;
        if (search) send({ type: 'notice', message: 'recherche web (OpenRouter)…' });
        try {
          for await (const chunk of chatStream({
            model,
            web: search,
            messages:
              part === 0
                ? messages
                : [...messages, { role: 'assistant', content: text }, { role: 'user', content: CONTINUE_PROMPT }],
            signal: controller.signal,
            onRetry: (message) => send({ type: 'notice', message }),
          })) {
            if (chunk.type === 'delta') {
              text += chunk.text;
              send(chunk);
            } else if (chunk.type === 'usage') total.usage = addUsage(total.usage, chunk.usage);
            else if (chunk.type === 'finish') finish = chunk.reason;
            else if (!chunk.model.startsWith(model)) send(chunk);
          }
        } catch (err) {
          if (controller.signal.aborted || !text.trim() || part >= MAX_CONTINUATIONS) throw err;
          finish = 'length';
          send({
            type: 'notice',
            message: `${err instanceof Error ? err.message : String(err)} : reprise de la réponse`,
          });
        }
        if (finish !== 'length' || part >= MAX_CONTINUATIONS) return text;
        send({ type: 'notice', message: 'réponse coupée : suite demandée' });
      }
    };

    const proposal = emptyProposal();
    for (let round = 0; ; round++) {
      const text = await ask(round === 0 ? resumed : '');
      const errors = await absorb(project, proposal, parseAnswer(text).filter(isBlock));
      if (!hasProposal(proposal) && errors.length === 0) break;
      const checked = await verify(project, proposal);
      const all = [...errors, ...checked.errors];
      if (all.length === 0) {
        send({ type: 'plan', plan: checked.plan });
        break;
      }
      if (round >= MAX_REPAIRS) {
        // keep what passes: the user validates it, the rest is listed as left out
        if (planIsEmpty(checked.plan)) send({ type: 'invalid', errors: all });
        else send({ type: 'plan', plan: { ...checked.plan, dropped: all } });
        break;
      }
      log.debug(`assistant : correction ${round + 1}/${MAX_REPAIRS} (${all.length} erreur(s))`);
      send({ type: 'repair', round: round + 1, errors: all });
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: repairPrompt(all) });
    }
    send({ type: 'done', usage: total.usage });
    const u = total.usage;
    if (u) {
      log.debug(
        `assistant ${model} : ${u.promptTokens} (dont ${u.cachedTokens} en cache) + ${u.completionTokens} jetons`,
      );
    }
  } catch (err) {
    if (!controller.signal.aborted) send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
}

/** Stable instructions, then the project: two cache breakpoints where the provider needs them. */
function systemMessage(model: string, stable: string, project: string): ChatMessage {
  if (!explicitCache(model)) return { role: 'system', content: `${stable}\n\n${project}` };
  const parts: TextPart[] = [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: project, cache_control: { type: 'ephemeral' } },
  ];
  return { role: 'system', content: parts };
}

/** The last messages, earlier answers without their code. */
function history(messages: ChatRequest['messages']): ChatMessage[] {
  let recent = messages.slice(-HISTORY);
  // a conversation sent to the model starts with the user
  while (recent[0]?.role === 'assistant') recent = recent.slice(1);
  return recent.map((m, i) =>
    m.role === 'assistant' && i < recent.length - 1
      ? { role: 'assistant', content: compactAnswer(m.content, m.outcome ?? 'pending') }
      : { role: m.role, content: m.content },
  );
}
