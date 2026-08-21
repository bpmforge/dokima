import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  listEvents,
  openEventLog,
  type EventLog,
} from '@dokima/events';
import {
  decideToolCall,
  getServer,
  loadMcpState,
  requestToolCall,
  setRoleAllowlist,
  type McpClient,
} from '@dokima/mcp';
import { preloadMcpServers } from './mcp-preload.js';
import type { McpServerSetting } from '../api/server/settings-types.js';

/**
 * W14-02. Law 9(a): every client here is a fake injected via `spawnClient`
 * — no child processes, no network. The stdio client itself is covered by
 * packages/mcp against its local fixture server.
 */

const dirs: string[] = [];
async function makeLog(): Promise<EventLog> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-preload-test-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'human' });
  createIdentity(log, { id: 'human-2', name: 'Approver', kind: 'human' });
  return log;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

/** Assembled at runtime, never a literal (validate-history-secrets). */
const PLANTED_SECRET = ['sk', 'abcdef0123456789deadbeef'].join('-');

function fakeClient(
  serverId: string,
  behavior: 'healthy' | 'broken' = 'healthy',
  seen?: { env?: Readonly<Record<string, string>>; calls: unknown[] },
): (spec: { id: string; env?: Readonly<Record<string, string>> }) => McpClient {
  return (spec) => {
    if (seen) seen.env = spec.env;
    return {
      serverId: spec.id,
      initialize: async () => {
        if (behavior === 'broken') {
          throw new Error(`server ${spec.id} refused initialize: wrong protocol`);
        }
      },
      listTools: async () => [
        { name: 'echo', description: 'echoes' },
        { name: 'deploy', description: 'side-effectful' },
      ],
      callTool: async (name, args) => {
        seen?.calls.push({ name, args });
        return { ok: true };
      },
      dispose: () => {},
    };
  };
}

const SERVER: McpServerSetting = { id: 'srv-a', command: 'fake', args: [] };

describe('preloadMcpServers (W14-02)', () => {
  it('RED FIXTURE: one healthy and one broken server — the healthy one registers and is callable end to end; the broken one is ledgered and the run proceeds', async () => {
    const log = await makeLog();
    const stderrLines: string[] = [];
    const seen = { calls: [] as unknown[] };

    const result = await preloadMcpServers({
      log,
      actorId: 'operator',
      runId: 'run-1',
      servers: [SERVER, { id: 'srv-bad', command: 'fake', args: [] }],
      resolveSecret: async () => undefined,
      stderr: (l) => stderrLines.push(l),
      secretValues: [],
      spawnClient: ((spec: { id: string }) =>
        (spec.id === 'srv-bad'
          ? fakeClient('srv-bad', 'broken')
          : fakeClient('srv-a', 'healthy', seen))(spec as never)) as never,
    });

    // Healthy: registered with namespaced tools, approval-defaulted.
    expect(getServer(log, 'srv-a')).toBeTruthy();
    expect(result.toolIds).toEqual(['srv-a.echo', 'srv-a.deploy']);
    const state = loadMcpState(log);
    expect(state.tools.get('srv-a.echo')?.requiresApproval).toBe(true);

    // Broken: ledgered + reported once, never registered, never fatal.
    expect(getServer(log, 'srv-bad')).toBeUndefined();
    expect(result.failures).toEqual([
      { serverId: 'srv-bad', reason: expect.stringContaining('wrong protocol') },
    ]);
    const failEvents = listEvents(log).filter(
      (e) => e.eventType === 'mcp.server_preload_failed',
    );
    expect(failEvents).toHaveLength(1);
    expect(stderrLines.join('\n')).toContain('srv-bad');
    expect(stderrLines.join('\n')).toContain('the run continues without it');

    // Callable end to end through the audited path: allowlist -> request
    // (parks, requiresApproval) -> decide by a DIFFERENT human (C-4) ->
    // executes on the composed executor.
    setRoleAllowlist(log, {
      role: 'coding-agent',
      toolIds: ['srv-a.echo'],
      actorId: 'operator',
    });
    const requested = await requestToolCall(
      log,
      {
        id: 'call-1',
        toolId: 'srv-a.echo',
        role: 'coding-agent',
        actorId: 'operator',
        args: { text: 'hi' },
      },
      result.executor,
    );
    expect(requested.status).toBe('pending');
    const decided = await decideToolCall(
      log,
      { id: 'call-1', decision: 'approved', decidedBy: 'human-2' },
      result.executor,
    );
    expect(decided.status).toBe('completed');
    expect(seen.calls).toEqual([{ name: 'echo', args: { text: 'hi' } }]);
  });

  it('a missing vault ref fails that server by NAME without spawning it, and the resolved value of a good ref reaches only the spawn env (Law 8)', async () => {
    const log = await makeLog();
    const stderrLines: string[] = [];
    const seen = { calls: [] as unknown[] } as {
      env?: Readonly<Record<string, string>>;
      calls: unknown[];
    };
    let spawned = 0;

    const result = await preloadMcpServers({
      log,
      actorId: 'operator',
      runId: 'run-1',
      servers: [
        { id: 'srv-missing', command: 'fake', env: { API_KEY: 'not-registered' } },
        { id: 'srv-good', command: 'fake', env: { API_KEY: 'my-key' } },
      ],
      resolveSecret: async (name) => (name === 'my-key' ? PLANTED_SECRET : undefined),
      stderr: (l) => stderrLines.push(l),
      secretValues: [PLANTED_SECRET],
      spawnClient: ((spec: never) => {
        spawned += 1;
        return fakeClient('srv-good', 'healthy', seen)(spec);
      }) as never,
    });

    expect(result.failures[0]!.reason).toContain('"not-registered"');
    expect(spawned).toBe(1); // the missing-ref server never spawned
    expect(seen.env?.API_KEY).toBe(PLANTED_SECRET);

    // The secret is nowhere in the event log — not in the failure event,
    // not in the registration (append-time redaction is the backstop).
    const serialized = JSON.stringify(listEvents(log));
    expect(serialized).not.toContain(PLANTED_SECRET);
  });

  it('is idempotent across runs: a server already in the log is not re-registered, but its client is live again', async () => {
    const log = await makeLog();
    const opts = {
      log,
      actorId: 'operator',
      runId: 'run-1',
      servers: [SERVER],
      resolveSecret: async () => undefined,
      stderr: () => {},
      secretValues: [],
      spawnClient: fakeClient('srv-a') as never,
    };
    const first = await preloadMcpServers(opts);
    first.dispose();
    const second = await preloadMcpServers({ ...opts, runId: 'run-2' });
    expect(second.failures).toEqual([]);
    expect(second.clients.has('srv-a')).toBe(true);
  });
});
