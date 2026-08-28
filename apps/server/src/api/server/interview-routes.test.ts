/**
 * W13-18. AC-1 says "Interview adapts question depth to my answers". The
 * engine that does it has existed since W5-02 with no production caller,
 * because a browser bundle may not call a model directly. This route is the
 * piece that was missing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApiServer } from '../server.js';
import { MAX_FOLLOWUP_DEPTH } from '@dokima/pipeline';

const TOKEN = 'interview-test-token';
const dirs: string[] = [];
let active: Awaited<ReturnType<typeof buildApiServer>> | null = null;
const realFetch = globalThis.fetch;

/**
 * LAW 9(a): NEVER A LIVE CALL.
 *
 * These tests reached a real LM Studio on 127.0.0.1:1234 — `resolveModelTarget`
 * falls back to `envTarget`, whose documented default is exactly that address —
 * and passed or failed depending on whether a model happened to be loaded and
 * how fast it was. They went green on coder-next and timed out at 5s the next
 * day on a 27B. A test that asks a real model is not a test of this route.
 *
 * Every case stubs `fetch`, which is what the oai-compat adapter resolves
 * (`config.fetchImpl ?? fetch`).
 */
/**
 * Answers BOTH shapes, because `chatJson` now prefers `chatStream`: a
 * non-streaming completion sends no headers until it finishes, and Node's
 * fetch abandons it at 300s (UND_ERR_HEADERS_TIMEOUT) — a ceiling no setting
 * can lift. A stub that only knew the blocking shape would leave this route
 * tested on a path production no longer takes.
 */
function stubModel(reply: unknown, status = 200): void {
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const wantsStream =
      typeof init?.body === 'string' &&
      (JSON.parse(init.body) as { stream?: boolean }).stream === true;
    if (!wantsStream || status !== 200) {
      return new Response(JSON.stringify(reply), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    const choice = (reply as { choices?: { message?: { content?: string } }[] }).choices?.[0];
    const content = choice?.message?.content ?? '';
    const usage = (reply as { usage?: unknown }).usage;
    const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
    const body =
      frame({
        id: 'x',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
      }) +
      frame({
        id: 'x',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage,
      }) +
      'data: [DONE]\n\n';
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
}

/** An endpoint that is simply not there — the local-only case, without waiting on a socket. */
function stubUnreachable(): void {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
}

function modelSays(content: string): unknown {
  return {
    id: 'x',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

afterEach(async () => {
  globalThis.fetch = realFetch;
  if (active) await active.app.close();
  active = null;
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

async function boot() {
  const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-interview-'));
  dirs.push(fleetHome);
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-iv-proj-'));
  dirs.push(projectPath);
  const server = await buildApiServer({
    token: TOKEN,
    port: 4412,
    isDbOpen: () => true,
    logger: false,
    fleetHome,
  });
  active = server;
  const created = await server.app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers: { host: '127.0.0.1:4412', authorization: `Bearer ${TOKEN}` },
    payload: { path: projectPath, name: 'IV', mode: 'import' },
  });
  return { app: server.app, id: created.json().id as string };
}

const headers = { host: '127.0.0.1:4412', authorization: `Bearer ${TOKEN}` };

describe('the adaptive follow-up route (W13-18)', () => {
  it(
    'RED FIXTURE: the route exists. AC-1 has promised adaptive depth since the ' +
      'user stories were written, and the engine that does it had nowhere to ' +
      'ask a model from',
    async () => {
      const { app, id } = await boot();
      stubModel(modelSays('{"question":"Who is it for?","done":false}'));
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/interview/next-question`,
        headers,
        payload: { deliverable_id: 'docs/VISION.md', question: 'What is it?', answers: ['a thing'] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().question).toBe('Who is it for?');
    },
  );

  it(
    'DEGRADES TO NO FOLLOW-UP when no model is reachable, rather than failing. ' +
      'A local-only user (C-1, D-024 option a) must still be able to describe ' +
      'their product — an interview that refuses to continue is worse than one ' +
      'that stops adapting',
    async () => {
      const { app, id } = await boot();
      stubUnreachable();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/interview/next-question`,
        headers,
        payload: { deliverable_id: 'docs/VISION.md', question: 'What is it?', answers: ['a thing'] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().question).toBeNull();
      expect(res.json().reason).toBe('unavailable');
    },
  );

  it(
    'ENFORCES THE DEPTH CEILING ITSELF. The engine has one; a bound only the ' +
      'other caller honours is not a bound, and this route can be called directly',
    async () => {
      const { app, id } = await boot();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/interview/next-question`,
        headers,
        payload: {
          deliverable_id: 'docs/VISION.md',
          question: 'What is it?',
          answers: Array.from({ length: MAX_FOLLOWUP_DEPTH }, (_, i) => `answer ${i}`),
        },
      });
      expect(res.json()).toEqual({ question: null, reason: 'depth-ceiling' });
    },
  );

  it('refuses a malformed request by name rather than guessing', async () => {
    const { app, id } = await boot();
    for (const payload of [
      {},
      { deliverable_id: 'x' },
      { deliverable_id: 'x', question: 'q' },
      { deliverable_id: 'x', question: 'q', answers: 'not-an-array' },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/interview/next-question`,
        headers,
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });
});
