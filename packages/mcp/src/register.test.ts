import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { McpError, type McpErrorCode } from './errors.js';
import {
  getServer,
  getTool,
  listServers,
  listToolsForRole,
  loadMcpState,
} from './query.js';
import { registerServer, setRoleAllowlist } from './register.js';
import { createTempDbPath, type TempDb } from './test-helpers.js';

const NOW = () => '2026-07-18T00:00:00.000Z';

async function setup(): Promise<{ temp: TempDb; log: EventLog }> {
  const temp = await createTempDbPath();
  const log = openEventLog(temp.dbPath);
  createIdentity(log, { id: 'human-1', name: 'Human One', kind: 'human' });
  createIdentity(log, { id: 'coding-agent', name: 'Coding Agent', kind: 'machine' });
  return { temp, log };
}

function expectRefusal(fn: () => unknown, code: McpErrorCode): void {
  let error: unknown;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(McpError);
  expect((error as McpError).code).toBe(code);
}

describe('registerServer (US-503: register MCP servers per project)', () => {
  let temp: TempDb;
  let log: EventLog;

  afterEach(async () => {
    log.close();
    await temp.cleanup();
  });

  it('registers a server and its tool catalog', async () => {
    ({ temp, log } = await setup());
    const server = registerServer(
      log,
      {
        id: 'fs-server',
        name: 'Filesystem server',
        transport: 'stdio',
        command: 'mcp-fs',
        tools: [
          { id: 'fs-server:read', name: 'read', requiresApproval: false },
          { id: 'fs-server:write', name: 'write', requiresApproval: true },
          { id: 'fs-server:shell', name: 'shell', requiresApproval: 'dynamic' },
        ],
        actorId: 'human-1',
      },
      { now: NOW },
    );

    expect(server.id).toBe('fs-server');
    expect(getServer(log, 'fs-server')).toEqual(server);
    expect(listServers(log)).toHaveLength(1);
    expect(getTool(log, 'fs-server:shell')?.requiresApproval).toBe('dynamic');
  });

  it('refuses a duplicate server id', async () => {
    ({ temp, log } = await setup());
    registerServer(
      log,
      { id: 'fs-server', name: 'FS', transport: 'stdio', tools: [], actorId: 'human-1' },
      { now: NOW },
    );
    expectRefusal(
      () =>
        registerServer(
          log,
          {
            id: 'fs-server',
            name: 'FS again',
            transport: 'stdio',
            tools: [],
            actorId: 'human-1',
          },
          { now: NOW },
        ),
      'SERVER_ALREADY_REGISTERED',
    );
  });

  it('refuses a tool id collision across servers', async () => {
    ({ temp, log } = await setup());
    registerServer(
      log,
      {
        id: 'fs-server',
        name: 'FS',
        transport: 'stdio',
        tools: [{ id: 'shared-id', name: 'read', requiresApproval: false }],
        actorId: 'human-1',
      },
      { now: NOW },
    );
    expectRefusal(
      () =>
        registerServer(
          log,
          {
            id: 'other-server',
            name: 'Other',
            transport: 'stdio',
            tools: [{ id: 'shared-id', name: 'read', requiresApproval: false }],
            actorId: 'human-1',
          },
          { now: NOW },
        ),
      'TOOL_ID_COLLISION',
    );
  });
});

describe('setRoleAllowlist (US-503 AC-1: per-role tool allowlists)', () => {
  let temp: TempDb;
  let log: EventLog;

  afterEach(async () => {
    log.close();
    await temp.cleanup();
  });

  it('sets which tools a role can see', async () => {
    ({ temp, log } = await setup());
    registerServer(
      log,
      {
        id: 'fs-server',
        name: 'FS',
        transport: 'stdio',
        tools: [
          { id: 'fs-server:read', name: 'read', requiresApproval: false },
          { id: 'fs-server:write', name: 'write', requiresApproval: true },
        ],
        actorId: 'human-1',
      },
      { now: NOW },
    );

    expect(listToolsForRole(log, 'coding-agent')).toEqual([]);

    setRoleAllowlist(
      log,
      { role: 'coding-agent', toolIds: ['fs-server:read'], actorId: 'human-1' },
      { now: NOW },
    );

    const visible = listToolsForRole(log, 'coding-agent');
    expect(visible.map((t) => t.id)).toEqual(['fs-server:read']);
    // Unlisted tool stays invisible to this role (AC-1).
    expect(visible.some((t) => t.id === 'fs-server:write')).toBe(false);
  });

  it('replaces the allowlist wholesale on a second call', async () => {
    ({ temp, log } = await setup());
    registerServer(
      log,
      {
        id: 'fs-server',
        name: 'FS',
        transport: 'stdio',
        tools: [
          { id: 'fs-server:read', name: 'read', requiresApproval: false },
          { id: 'fs-server:write', name: 'write', requiresApproval: true },
        ],
        actorId: 'human-1',
      },
      { now: NOW },
    );
    setRoleAllowlist(
      log,
      {
        role: 'coding-agent',
        toolIds: ['fs-server:read', 'fs-server:write'],
        actorId: 'human-1',
      },
      { now: NOW },
    );
    setRoleAllowlist(
      log,
      { role: 'coding-agent', toolIds: ['fs-server:read'], actorId: 'human-1' },
      { now: NOW },
    );
    expect(listToolsForRole(log, 'coding-agent').map((t) => t.id)).toEqual([
      'fs-server:read',
    ]);
  });

  it('refuses to allowlist an unknown tool id', async () => {
    ({ temp, log } = await setup());
    expectRefusal(
      () =>
        setRoleAllowlist(
          log,
          { role: 'coding-agent', toolIds: ['does-not-exist'], actorId: 'human-1' },
          { now: NOW },
        ),
      'TOOL_NOT_FOUND',
    );
  });

  it('rebuild-from-zero equals the live projection after registration + allowlist events', async () => {
    ({ temp, log } = await setup());
    registerServer(
      log,
      {
        id: 'fs-server',
        name: 'FS',
        transport: 'stdio',
        tools: [{ id: 'fs-server:read', name: 'read', requiresApproval: false }],
        actorId: 'human-1',
      },
      { now: NOW },
    );
    setRoleAllowlist(
      log,
      { role: 'coding-agent', toolIds: ['fs-server:read'], actorId: 'human-1' },
      { now: NOW },
    );
    const state = loadMcpState(log);
    expect(Array.from(state.servers.keys())).toEqual(['fs-server']);
    expect(Array.from(state.allowlist.get('coding-agent') ?? [])).toEqual([
      'fs-server:read',
    ]);
  });
});
