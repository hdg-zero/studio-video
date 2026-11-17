import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { streamChat, type ChatEvent } from '../src/ai/chat.js';
import { STUDIO_HOME } from '../src/core/home.js';
import { loadProject, type Project } from '../src/core/project.js';

/** A fake OpenRouter: answers each chat request with the next scripted stream. */
interface Script {
  readonly text: string;
  readonly finish?: string;
  readonly status?: number;
  /** Close the connection after the text, without finishing the stream. */
  readonly drop?: boolean;
}
let scripts: Script[] = [];
const searches: { url: string; token: unknown }[] = [];
const requests: { messages: { role: string; content: unknown }[]; models?: string[]; plugins?: unknown }[] = [];
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/brave')) {
    searches.push({ url: req.url, token: req.headers['x-subscription-token'] });
    res.end(
      JSON.stringify({
        web: {
          results: [
            { title: 'La <strong>tour</strong> de Babel', url: 'https://example.org/babel', description: 'Genèse 11' },
          ],
        },
      }),
    );
    return;
  }
  if (req.url?.endsWith('/models')) {
    res.end(JSON.stringify({ data: [{ id: 'anthropic/claude-sonnet-9', created: 2 }] }));
    return;
  }
  let body = '';
  req.on('data', (c: Buffer) => (body += c.toString()));
  req.on('end', () => {
    requests.push(JSON.parse(body) as (typeof requests)[number]);
    const s = scripts.shift() ?? { text: 'plus rien' };
    if (s.status) {
      res.writeHead(s.status).end(JSON.stringify({ error: { message: 'surcharge' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (let i = 0; i < s.text.length; i += 40)
      res.write(
        `data: ${JSON.stringify({ model: 'anthropic/claude-sonnet-9', choices: [{ delta: { content: s.text.slice(i, i + 40) } }] })}\n\n`,
      );
    if (s.drop) {
      setTimeout(() => res.destroy(), 50);
      return;
    }
    const usage = {
      prompt_tokens: 1000,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 800 },
      cost: 0.001,
    };
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: s.finish ?? 'stop' }], usage })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});

let dir: string;
let project: Project;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.OPENROUTER_API_KEY = 'test-only';
  dir = mkdtempSync(path.join(tmpdir(), 'studio-chat-'));
  cpSync(path.join(STUDIO_HOME, 'templates', 'capsule'), path.join(dir, 'demo'), { recursive: true });
  project = await loadProject(path.join(dir, 'demo'));
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.OPENROUTER_API_KEY;
});

/** Runs the endpoint against a fake response object and returns the events it sent. */
async function chat(
  content: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  resume = false,
  web: boolean | 'openrouter' | 'brave' | 'tavily' = false,
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  const res = {
    writableEnded: false,
    on: () => res,
    writeHead: () => res,
    write: (chunk: string) => {
      for (const frame of chunk.split('\n\n'))
        if (frame.startsWith('data: ')) events.push(JSON.parse(frame.slice(6)) as ChatEvent);
      return true;
    },
    end: () => {
      res.writableEnded = true;
    },
  };
  requests.length = 0;
  await streamChat(res as unknown as http.ServerResponse, project, {
    messages: resume ? history : [...history, { role: 'user', content }],
    focus: {},
    resume,
    web,
  });
  return events;
}

const idee = (): string => readFileSync(path.join(dir, 'demo', 'scenes', 'idee.ts'), 'utf8');

describe('streamChat', () => {
  it('sends errors back to the model and returns the corrected plan', async () => {
    scripts = [
      { text: `Voici.\n\`\`\`scene:idee\n${idee().replace("'idee'", "'autre'")}\`\`\`\n` },
      {
        text: "Corrigé.\n```scene-patch:idee\n<<<<<<< SEARCH\nexport default defineScene('autre',\n=======\nexport default defineScene('idee',\n>>>>>>> REPLACE\n```",
      },
    ];
    const events = await chat('Change la scène idee');
    const types = events.map((e) => e.type).filter((t) => t !== 'delta');
    expect(types).toEqual(['start', 'repair', 'plan', 'done']);
    const repair = events.find((e) => e.type === 'repair');
    expect(repair?.type === 'repair' && repair.errors.join()).toMatch(/defineScene\('autre'\)/);
    // the error is what the model gets back, after its own answer
    expect(JSON.stringify(requests[1]?.messages.at(-1))).toMatch(/defineScene\('autre'\)/);
    const plan = events.find((e) => e.type === 'plan');
    expect(plan?.type === 'plan' && plan.plan.scenes[0]?.code).toContain("defineScene('idee'");
    // usage of both calls, with the cached part
    const done = events.at(-1);
    expect(done?.type === 'done' && done.usage).toEqual({
      promptTokens: 2000,
      completionTokens: 100,
      cachedTokens: 1600,
      cost: 0.002,
    });
  }, 30_000);

  it('searches the web once per question when asked, and never falls back to another model', async () => {
    scripts = [
      { text: `Voici.\n\`\`\`scene:idee\n${idee().replace("'idee'", "'autre'")}\`\`\`\n` },
      {
        text: "Corrigé.\n```scene-patch:idee\n<<<<<<< SEARCH\nexport default defineScene('autre',\n=======\nexport default defineScene('idee',\n>>>>>>> REPLACE\n```",
      },
    ];
    const events = await chat('Change la scène idee', [], false, true);
    expect(requests[0]?.plugins).toEqual([{ id: 'web', max_results: 5 }]);
    // the correction reuses what was found
    expect(requests[1]?.plugins).toBeUndefined();
    expect(requests.every((r) => r.models === undefined)).toBe(true);
    expect(events.some((e) => e.type === 'notice' && /recherche web/.test(e.message))).toBe(true);
    await chat('Bonjour');
    expect(requests[0]?.plugins).toBeUndefined();
  });

  it('searches with Brave and gives the results to the model, or answers without them', async () => {
    process.env.BRAVE_API_KEY = 'test-brave';
    process.env.BRAVE_SEARCH_URL = `${process.env.OPENROUTER_BASE_URL ?? ''}/brave`;
    try {
      scripts = [{ text: 'Selon [1], Genèse 11.' }];
      await chat('Où raconte-t-on la tour de Babel ?', [], false, 'brave');
      expect(searches.at(-1)?.token).toBe('test-brave');
      expect(new URL(searches.at(-1)?.url ?? '', 'http://x').searchParams.get('q')).toBe(
        'Où raconte-t-on la tour de Babel ?',
      );
      const question = JSON.stringify(requests[0]?.messages.at(-1));
      expect(question).toContain('https://example.org/babel');
      expect(question).toContain('La tour de Babel');
      expect(requests[0]?.plugins).toBeUndefined();

      scripts = [{ text: 'Sans le web.' }];
      const events = await chat('Et Tavily ?', [], false, 'tavily');
      expect(events.some((e) => e.type === 'notice' && /TAVILY_API_KEY.*sans recherche web/.test(e.message))).toBe(
        true,
      );
      expect(events.at(-1)?.type).toBe('done');
    } finally {
      delete process.env.BRAVE_API_KEY;
      delete process.env.BRAVE_SEARCH_URL;
    }
  });

  it('puts the stable prompt first with a cache mark, and the mentioned scene in the context', async () => {
    scripts = [{ text: 'Rien à changer.' }];
    const events = await chat('Que penses-tu de idee ?');
    expect(events.map((e) => e.type).filter((t) => t !== 'delta')).toEqual(['start', 'done']);
    const system = requests[0]?.messages[0]?.content as { text: string; cache_control?: unknown }[];
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0]?.text).toMatch(/Format des réponses/);
    expect(system[1]?.text).toMatch(/Code actuel de scenes\/idee\.ts/);
  });

  it('continues an answer cut by the token limit', async () => {
    const block = '```studio-edits\n{"edits":[{"op":"update","id":"idee","fields":{"text":"Nouveau texte."}}]}\n```';
    scripts = [{ text: block.slice(0, 30), finish: 'length' }, { text: block.slice(30) }];
    const events = await chat('Réécris idee');
    expect(events.some((e) => e.type === 'notice')).toBe(true);
    expect(events.find((e) => e.type === 'plan')).toBeDefined();
    expect(JSON.stringify(requests[1]?.messages.at(-1))).toMatch(/coupée/);
  });

  it('retries a transient failure, then explains a fatal one', async () => {
    scripts = [{ text: '', status: 503 }, { text: 'Bonjour.' }];
    const ok = await chat('Bonjour');
    expect(ok.some((e) => e.type === 'notice')).toBe(true);
    expect(ok.at(-1)?.type).toBe('done');

    scripts = [{ text: '', status: 402 }];
    const fatal = await chat('Bonjour');
    const error = fatal.at(-1);
    expect(error?.type === 'error' && error.message).toMatch(/crédit insuffisant/);
  }, 15_000);

  it('keeps the valid part when corrections run out', async () => {
    const bad =
      '```studio-edits\n{"edits":[{"op":"update","id":"absent","fields":{"text":"x"}},{"op":"update","id":"intro","fields":{"text":"Gardé."}}]}\n```';
    scripts = [{ text: bad }, { text: 'Encore.\n' + bad }, { text: 'Toujours.\n' + bad }];
    const events = await chat('Réécris');
    expect(events.filter((e) => e.type === 'repair')).toHaveLength(2);
    // the correction asks only for the failing operation
    expect(JSON.stringify(requests[1]?.messages.at(-1))).toMatch(/gardé ce qui est valide/);
    const plan = events.find((e) => e.type === 'plan');
    expect(plan?.type === 'plan' && plan.plan.edits).toEqual([
      { op: 'update', id: 'intro', fields: { text: 'Gardé.' } },
    ]);
    expect(plan?.type === 'plan' && plan.plan.dropped.join()).toMatch(/absent/);
  }, 15_000);

  it('picks up an answer whose connection was lost', async () => {
    const block = '```studio-edits\n{"edits":[{"op":"update","id":"idee","fields":{"text":"Repris."}}]}\n```';
    scripts = [{ text: block.slice(0, 40), drop: true }, { text: block.slice(40) }];
    const events = await chat('Réécris idee');
    expect(events.some((e) => e.type === 'notice')).toBe(true);
    expect(events.find((e) => e.type === 'plan')).toBeDefined();
  });

  it('resumes an interrupted answer sent back by the browser', async () => {
    const block = '```studio-edits\n{"edits":[{"op":"update","id":"idee","fields":{"text":"Fini."}}]}\n```';
    scripts = [{ text: block.slice(30) }];
    const events = await chat(
      '',
      [
        { role: 'user', content: 'Réécris idee' },
        { role: 'assistant', content: block.slice(0, 30) },
      ],
      true,
    );
    // the partial answer is sent as is, then the model is asked for the rest
    expect(JSON.stringify(requests[0]?.messages.at(-2))).toContain(
      block.slice(0, 30).replace(/\n/g, '\\n').replace(/"/g, '\\"'),
    );
    expect(JSON.stringify(requests[0]?.messages.at(-1))).toMatch(/coupée/);
    const plan = events.find((e) => e.type === 'plan');
    expect(plan?.type === 'plan' && plan.plan.edits).toHaveLength(1);
  });
});
