import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { getServer, listToolCalls, listToolsForRole } from '@dokima/mcp';
import {
  agentSessionToolId,
  ensureAgentSessionToolsRegistered,
  runToolCalls,
} from './mcp-wiring.js';
import { AGENT_SESSION_TOOL_NAMES } from './tools.js';
import type { ToolCall } from './gateway-tool-types.js';

describe('agent-session mcp-wiring', () => {
  let dbDir: string | undefined;
  let log: EventLog | undefined;
  let cwd: string | undefined;

  afterEach(async () => {
    log?.close();
    log = undefined;
    if (dbDir) await fs.rm(dbDir, { recursive: true, force: true });
    dbDir = undefined;
    if (cwd) await fs.rm(cwd, { recursive: true, force: true });
    cwd = undefined;
  });

  async function setup(): Promise<{ log: EventLog; cwd: string }> {
    dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-agent-mcp-'));
    log = openEventLog(path.join(dbDir, 'state.db'));
    createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-agent-mcp-cwd-'));
    return { log, cwd };
  }

  it('registers exactly the seven closed tools and allowlists them for the role (SC-18)', async () => {
    const { log } = await setup();
    ensureAgentSessionToolsRegistered(log, { role: 'coding-agent', actorId: 'worker-1' });

    const server = getServer(log, 'agent-session');
    expect(server).toBeDefined();
    const allowed = listToolsForRole(log, 'coding-agent')
      .map((t) => t.id)
      .sort();
    expect(allowed).toEqual(AGENT_SESSION_TOOL_NAMES.map(agentSessionToolId).sort());
    expect(allowed).toHaveLength(7);
  });

  it('registration is idempotent across repeated calls sharing one EventLog', async () => {
    const { log } = await setup();
    ensureAgentSessionToolsRegistered(log, { role: 'coding-agent', actorId: 'worker-1' });
    ensureAgentSessionToolsRegistered(log, { role: 'coding-agent', actorId: 'worker-1' });
    ensureAgentSessionToolsRegistered(log, { role: 'coding-agent', actorId: 'worker-1' });

    expect(getServer(log, 'agent-session')).toBeDefined();
    const allowed = listToolsForRole(log, 'coding-agent')
      .map((t) => t.id)
      .sort();
    expect(allowed).toEqual(AGENT_SESSION_TOOL_NAMES.map(agentSessionToolId).sort());
  });

  it('a different role gets no tools until explicitly registered (US-503 AC-1)', async () => {
    const { log } = await setup();
    ensureAgentSessionToolsRegistered(log, { role: 'coding-agent', actorId: 'worker-1' });
    expect(listToolsForRole(log, 'reviewer')).toEqual([]);
  });

  it('runs a valid tool call end to end and audits it (US-503 AC-3)', async () => {
    const { log, cwd } = await setup();
    ensureAgentSessionToolsRegistered(log, { role: 'coding-agent', actorId: 'worker-1' });

    const call: ToolCall = {
      id: 'call_1',
      name: 'write',
      arguments: { path: 'a.ts', content: 'x' },
    };
    const text = await runToolCalls(
      [call],
      { cwd, writeScope: ['**'], verifyCommand: 'true', verifyTimeoutMs: 5000 },
      {
        log,
        role: 'coding-agent',
        actorId: 'worker-1',
        ticketId: 'W9-01',
        runId: 'run-1',
      },
    );

    expect(text).toContain('TOOL_RESULT call_1 (write)');
    expect(text).toContain('"ok":true');
    await expect(fs.readFile(path.join(cwd, 'a.ts'), 'utf8')).resolves.toBe('x');

    const calls = listToolCalls(log);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.toolId).toBe('agent-session.write');
    expect(calls[0]!.status).toBe('completed');
  });

  it('a call to an unlisted tool gets a refusal result, not an execution (SC-18 Verify)', async () => {
    const { log, cwd } = await setup();
    ensureAgentSessionToolsRegistered(log, { role: 'coding-agent', actorId: 'worker-1' });

    const call: ToolCall = {
      id: 'call_2',
      name: 'shell',
      arguments: { command: 'rm -rf /' },
    };
    const text = await runToolCalls(
      [call],
      { cwd, writeScope: ['**'], verifyCommand: 'true', verifyTimeoutMs: 5000 },
      {
        log,
        role: 'coding-agent',
        actorId: 'worker-1',
        ticketId: 'W9-01',
        runId: 'run-1',
      },
    );

    expect(text).toContain('"refusal"');
    expect(text).toContain('TOOL_NOT_FOUND');
    expect(listToolCalls(log)).toHaveLength(0);
  });

  it('a malformed args call is refused as data, not thrown as an exception', async () => {
    const { log, cwd } = await setup();
    ensureAgentSessionToolsRegistered(log, { role: 'coding-agent', actorId: 'worker-1' });

    const call: ToolCall = { id: 'call_3', name: 'write', arguments: { path: 'a.ts' } };
    const text = await runToolCalls(
      [call],
      { cwd, writeScope: ['**'], verifyCommand: 'true', verifyTimeoutMs: 5000 },
      {
        log,
        role: 'coding-agent',
        actorId: 'worker-1',
        ticketId: 'W9-01',
        runId: 'run-1',
      },
    );
    expect(text).toContain('"refusal"');
  });
});
