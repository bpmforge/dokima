// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBoardData } from './useBoardData.js';

/**
 * Review R1: nothing in the app passed `runId`, so the board never
 * subscribed to `run:{id}` and no heartbeat could ever reach a card. The hook
 * now finds the live run itself from `GET .../build-runs`.
 */
class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  private listeners = new Map<string, ((event: unknown) => void)[]>();
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, fn: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  emit(type: string, event: unknown = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  FakeSocket.all = [];
});

describe('useBoardData follows the live run (review R1)', () => {
  it('subscribes to run:{id} of the run with no outcome and applies its heartbeats', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/build-runs')) {
        return json({
          runs: [
            { runId: 'run-live', outcome: null, tickets: [] },
            { runId: 'run-old', outcome: 'verified', tickets: [] },
          ],
        });
      }
      return json({ items: [] });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useBoardData({
        baseUrl: '/api/v1',
        token: 't',
        projectId: 'P1',
        wsUrl: 'ws://localhost/api/v1/ws',
        fetchImpl,
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      }),
    );

    let socket!: FakeSocket;
    await waitFor(() => {
      socket = FakeSocket.all.at(-1)!;
      act(() => socket.emit('open'));
      expect(socket.sent.at(-1)).toContain('run:run-live');
    });
    expect(socket.sent.at(-1)).toContain('board:P1');
    expect(socket.sent.join()).not.toContain('run:run-old');

    const message = (type: string, data: unknown, seq: number) =>
      act(() =>
        socket.emit('message', {
          data: JSON.stringify({ sub: 'run:run-live', seq, type, at: '', data }),
        }),
      );
    message(
      'loop.heartbeat',
      { ticket: 'T-1', run: 'run-live', phase: 'working', age_s: 1 },
      1,
    );
    expect(result.current.heartbeats.get('T-1')).toMatchObject({ phase: 'working' });
    expect(result.current.heartbeats.get('T-1')?.receivedAtMs).toEqual(
      expect.any(Number),
    );

    message('loop.run_ended', { run: 'run-live' }, 2);
    expect(result.current.heartbeats.size).toBe(0);
  });

  it('does not poll when the caller names the run', async () => {
    const fetchImpl = vi.fn(async () => json({ items: [] })) as unknown as typeof fetch;
    renderHook(() =>
      useBoardData({
        baseUrl: '/api/v1',
        token: 't',
        projectId: 'P1',
        runId: 'run-named',
        wsUrl: 'ws://localhost/api/v1/ws',
        fetchImpl,
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      }),
    );
    const socket = FakeSocket.all.at(-1)!;
    act(() => socket.emit('open'));
    expect(socket.sent[0]).toContain('run:run-named');
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const urls = (
      fetchImpl as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith('/build-runs'))).toBe(false);
  });
});
