import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { registerServer, setRoleAllowlist } from '@dokima/mcp';
import { composeExternalToolset } from './mcp-session-tools.js';
import type { McpPreloadResult } from './mcp-preload.js';

const dirs: string[] = [];
let openLog: EventLog | undefined;
afterEach(async () => {
  openLog?.close();
  openLog = undefined;
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function makeLog(): Promise<EventLog> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-toolset-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  openLog = log;
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'human' });
  registerServer(log, {
    id: 'srv-x',
    name: 'External X',
    transport: 'stdio',
    tools: [
      { id: 'srv-x.deploy', name: 'deploy', description: null, requiresApproval: true },
      { id: 'srv-x.status', name: 'status', description: 'read-only', requiresApproval: true },
    ],
    actorId: 'operator',
  });
  return log;
}

function preload(toolIds: string[]): McpPreloadResult {
  return {
    clients: new Map(),
    executor: async () => ({ result: null, cost: 0 }),
    toolIds,
    failures: [],
    dispose: () => {},
  };
}

describe('composeExternalToolset (W14-03, FR-I3)', () => {
  it('RED FIXTURE: a role with NO allowlist entry sees no external tool at all — no grants means the closed seven, unchanged', async () => {
    const log = await makeLog();
    expect(
      composeExternalToolset(log, 'coding-agent', preload(['srv-x.deploy', 'srv-x.status'])),
    ).toBeUndefined();
  });

  it('offers schemas only for tools BOTH granted to the role AND live in this run', async () => {
    const log = await makeLog();
    setRoleAllowlist(log, {
      role: 'coding-agent',
      // status is granted but not live; deploy is both.
      toolIds: ['srv-x.deploy', 'srv-x.status'],
      actorId: 'operator',
    });
    const toolset = composeExternalToolset(log, 'coding-agent', preload(['srv-x.deploy']));
    expect(toolset?.schemas.map((s) => s.name)).toEqual(['srv-x.deploy']);
    expect(toolset?.toolIds.has('srv-x.status')).toBe(false);
  });

  it('a preload with no live tools composes nothing', async () => {
    const log = await makeLog();
    setRoleAllowlist(log, {
      role: 'coding-agent',
      toolIds: ['srv-x.deploy'],
      actorId: 'operator',
    });
    expect(composeExternalToolset(log, 'coding-agent', preload([]))).toBeUndefined();
  });
});
