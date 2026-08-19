/**
 * W13-16. The ledger is the thing that must not move: a streamed turn has to
 * meter exactly what a non-streamed one did, or the session runs faster and
 * pays for nothing.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import type { ChatResponse, Provider } from '@dokima/gateway';
import { runStreamedTurn, StreamEndedWithoutFinalError } from './session-stream.js';

const RESPONSE: ChatResponse = {
  message: { role: 'assistant', content: 'done' },
  usage: { promptTokens: 11, completionTokens: 7, costUsd: 0.25 },
} as unknown as ChatResponse;

function streamingProvider(events: unknown[]): Provider {
  return {
    chat: vi.fn(async () => RESPONSE),
    chatStream: async function* () {
      for (const e of events) yield e as never;
    },
  } as unknown as Provider;
}

const REQUEST = {
  model: 'm',
  messages: [{ role: 'user' as const, content: 'hi' }],
};

describe('runStreamedTurn (W13-16)', () => {
  it(
    'RED FIXTURE: the streamed path returns the SAME response the non-streamed ' +
      'path would, usage included — the ledger cannot tell them apart',
    async () => {
      const streamed = await runStreamedTurn({
        provider: streamingProvider([
          { type: 'delta', content: 'do' },
          { type: 'delta', content: 'ne' },
          { type: 'final', response: RESPONSE },
        ]),
        request: REQUEST as never,
        actorId: 'agent',
      });
      const plain = await runStreamedTurn({
        provider: { chat: vi.fn(async () => RESPONSE) } as unknown as Provider,
        request: REQUEST as never,
        actorId: 'agent',
      });

      expect(streamed.response.usage).toEqual(plain.response.usage);
      expect(streamed.response.message.content).toBe(plain.response.message.content);
      expect(streamed.streamed).toBe(true);
      expect(plain.streamed).toBe(false);
    },
  );

  it(
    'progress is observable BEFORE the call completes — the whole point, and ' +
      'the thing a fixture asserting only the final response would miss',
    async () => {
      const seen: string[] = [];
      let finalArrived = false;
      const provider = {
        chatStream: async function* () {
          yield { type: 'delta', content: 'a' } as never;
          // The assertion that matters: content was already delivered to the
          // caller at this point, with the model call still open.
          expect(seen).toEqual(['a']);
          yield { type: 'delta', content: 'b' } as never;
          finalArrived = true;
          yield { type: 'final', response: RESPONSE } as never;
        },
      } as unknown as Provider;

      const result = await runStreamedTurn({
        provider,
        request: REQUEST as never,
        actorId: 'agent',
        onDelta: (chunk) => seen.push(chunk),
      });
      expect(seen).toEqual(['a', 'b']);
      expect(finalArrived).toBe(true);
      expect(result.deltaChars).toBe(2);
    },
  );

  it(
    'a stream that ends with no final event is an ERROR, not an empty answer. ' +
      'A blank response would look like a model choosing to say nothing and ' +
      'would meter zero — the failure streaming was meant to remove, arriving ' +
      'silently',
    async () => {
      await expect(
        runStreamedTurn({
          provider: streamingProvider([{ type: 'delta', content: 'x' }]),
          request: REQUEST as never,
          actorId: 'agent',
        }),
      ).rejects.toBeInstanceOf(StreamEndedWithoutFinalError);
    },
  );

  it(
    'falls back to chat() when the adapter has no chatStream, rather than ' +
      'trading the ledger for progress (acceptance 3)',
    async () => {
      const chat = vi.fn(async () => RESPONSE);
      const result = await runStreamedTurn({
        provider: { chat } as unknown as Provider,
        request: REQUEST as never,
        actorId: 'agent',
      });
      expect(chat).toHaveBeenCalledOnce();
      expect(result.streamed).toBe(false);
      expect(result.response.usage).toEqual(RESPONSE.usage);
    },
  );

  it('does not call chat() when it streamed — one turn is one billable call', async () => {
    const chat = vi.fn(async () => RESPONSE);
    const provider = {
      chat,
      chatStream: async function* () {
        yield { type: 'final', response: RESPONSE } as never;
      },
    } as unknown as Provider;
    await runStreamedTurn({ provider, request: REQUEST as never, actorId: 'agent' });
    expect(chat).not.toHaveBeenCalled();
  });

  describe('what lands in the durable log', () => {
    const dirs: string[] = [];
    let log: EventLog | undefined;

    afterEach(async () => {
      log?.close();
      log = undefined;
      await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
    });

    async function openLog(): Promise<EventLog> {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-stream-log-'));
      dirs.push(dir);
      const opened = openEventLog(path.join(dir, 'state.db'));
      createIdentity(opened, { id: 'agent', name: 'Agent', kind: 'machine' });
      log = opened;
      return opened;
    }

    it(
      'ONE session.producing per turn, however many deltas arrive. The log is ' +
        'append-only and hash-chained: it is the product’s durable explanation ' +
        'of itself, not a place to put a keystroke stream',
      async () => {
        const opened = await openLog();
        const deltas = Array.from({ length: 50 }, (_, i) => ({
          type: 'delta',
          content: String(i),
        }));
        await runStreamedTurn({
          provider: streamingProvider([...deltas, { type: 'final', response: RESPONSE }]),
          request: REQUEST as never,
          log: opened,
          actorId: 'agent',
          ticketId: 'T-1',
          runId: 'run-1',
        });

        const producing = listEvents(opened).filter(
          (e) => e.eventType === 'session.producing',
        );
        expect(producing).toHaveLength(1);
        expect(producing[0]?.ticketId).toBe('T-1');
        expect(producing[0]?.runId).toBe('run-1');
      },
    );

    it('and none at all when the turn produced nothing to be live about', async () => {
      const opened = await openLog();
      await runStreamedTurn({
        provider: streamingProvider([{ type: 'final', response: RESPONSE }]),
        request: REQUEST as never,
        log: opened,
        actorId: 'agent',
      });
      expect(
        listEvents(opened).filter((e) => e.eventType === 'session.producing'),
      ).toHaveLength(0);
    });
  });

  describe('the call is open (W13-16, found by the supervised run)', () => {
    it(
      'session.turn_started lands BEFORE any delta. 15 of the supervised run’s ' +
        '18.7 seconds produced no signal because the first turn emitted only ' +
        'tool_calls, and ChatStreamDelta carries only content — so a watcher ' +
        'needs a start time to subtract from, or silence is indistinguishable ' +
        'from a hang',
      async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-stream-open-'));
        const opened = openEventLog(path.join(dir, 'state.db'));
        createIdentity(opened, { id: 'agent', name: 'Agent', kind: 'machine' });
        try {
          // A turn with NO content at all — exactly the tool-calling turn that
          // was dark for 15 seconds.
          await runStreamedTurn({
            provider: streamingProvider([{ type: 'final', response: RESPONSE }]),
            request: REQUEST as never,
            log: opened,
            actorId: 'agent',
            ticketId: 'T-1',
          });
          const types = listEvents(opened).map((e) => e.eventType);
          expect(types).toContain('session.turn_started');
          // And still no `producing`, because nothing was produced.
          expect(types).not.toContain('session.producing');
        } finally {
          opened.close();
          await fs.rm(dir, { recursive: true, force: true });
        }
      },
    );

    it('and it is not emitted on the non-streaming fallback, which has nothing to observe', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-stream-open2-'));
      const opened = openEventLog(path.join(dir, 'state.db'));
      createIdentity(opened, { id: 'agent', name: 'Agent', kind: 'machine' });
      try {
        await runStreamedTurn({
          provider: { chat: async () => RESPONSE } as never,
          request: REQUEST as never,
          log: opened,
          actorId: 'agent',
        });
        expect(listEvents(opened).map((e) => e.eventType)).not.toContain(
          'session.turn_started',
        );
      } finally {
        opened.close();
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('a tool-only turn is observable (W13-20)', () => {
    const dirs2: string[] = [];
    let log2: EventLog | undefined;

    afterEach(async () => {
      log2?.close();
      log2 = undefined;
      await Promise.all(dirs2.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
    });

    async function openLog2(): Promise<EventLog> {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-toolturn-'));
      dirs2.push(dir);
      const opened = openEventLog(path.join(dir, 'state.db'));
      createIdentity(opened, { id: 'agent', name: 'Agent', kind: 'machine' });
      log2 = opened;
      return opened;
    }

    it(
      'RED FIXTURE: a turn that emits ONLY tool calls announces itself. This ' +
        'was 41% of one model’s turns, and it looked exactly like a hang — ' +
        'session.producing fired on text alone, and a tool-calling turn has none',
      async () => {
        const opened = await openLog2();
        const seen: string[] = [];
        const result = await runStreamedTurn({
          provider: streamingProvider([
            { type: 'tool_call', index: 0, name: 'read' },
            { type: 'tool_call', index: 1, name: 'verify' },
            { type: 'final', response: RESPONSE },
          ]),
          request: REQUEST as never,
          log: opened,
          actorId: 'agent',
          ticketId: 'T-1',
          onToolCall: (name) => seen.push(name),
        });

        const producing = listEvents(opened).filter((e) => e.eventType === 'session.producing');
        expect(producing).toHaveLength(1);
        // Names WHAT it is doing, not merely that it is alive.
        expect((producing[0]?.payload as { tool?: string }).tool).toBe('read');
        expect(seen).toEqual(['read', 'verify']);
        expect(result.toolCalls).toEqual(['read', 'verify']);
      },
    );

    it(
      'still ONE producing event per turn when tools and text both arrive — the ' +
        'log is append-only and hash-chained, not a place for a keystroke stream',
      async () => {
        const opened = await openLog2();
        await runStreamedTurn({
          provider: streamingProvider([
            { type: 'tool_call', index: 0, name: 'read' },
            { type: 'delta', content: 'thinking' },
            { type: 'tool_call', index: 1, name: 'write' },
            { type: 'delta', content: ' more' },
            { type: 'final', response: RESPONSE },
          ]),
          request: REQUEST as never,
          log: opened,
          actorId: 'agent',
        });
        expect(
          listEvents(opened).filter((e) => e.eventType === 'session.producing'),
        ).toHaveLength(1);
      },
    );

    it('the non-streaming fallback reports no tool calls rather than guessing', async () => {
      const result = await runStreamedTurn({
        provider: { chat: async () => RESPONSE } as never,
        request: REQUEST as never,
        actorId: 'agent',
      });
      expect(result.toolCalls).toEqual([]);
    });
  });
});
