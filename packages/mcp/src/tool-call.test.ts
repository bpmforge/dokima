import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@shipwright/events';
import { digestOf } from './digest.js';
import { McpError } from './errors.js';
import { getPendingApproval, listPendingApprovals, listToolCalls } from './query.js';
import { registerServer, setRoleAllowlist } from './register.js';
import { createTempDbPath, type TempDb } from './test-helpers.js';
import { decideToolCall, requestToolCall, type ToolExecutor } from './tool-call.js';

const NOW = () => '2026-07-18T00:00:00.000Z';
const LATER = () => '2026-07-18T00:05:00.000Z';

async function setup(): Promise<{ temp: TempDb; log: EventLog }> {
  const temp = await createTempDbPath();
  const log = openEventLog(temp.dbPath);
  createIdentity(log, { id: 'human-1', name: 'Human One', kind: 'human' });
  createIdentity(log, { id: 'human-2', name: 'Human Two', kind: 'human' });
  createIdentity(log, { id: 'coding-agent', name: 'Coding Agent', kind: 'machine' });

  registerServer(
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
  setRoleAllowlist(
    log,
    {
      role: 'coding-agent',
      toolIds: ['fs-server:read', 'fs-server:write', 'fs-server:shell'],
      actorId: 'human-1',
    },
    { now: NOW },
  );

  return { temp, log };
}

describe('requestToolCall (US-503 AC-1/AC-2/AC-3, SC-12)', () => {
  let temp: TempDb;
  let log: EventLog;

  afterEach(async () => {
    log.close();
    await temp.cleanup();
  });

  it('refuses a tool the role has no allowlist entry for, without calling the executor', async () => {
    ({ temp, log } = await setup());
    const executor = vi.fn<ToolExecutor>();
    let error: unknown;
    try {
      await requestToolCall(
        log,
        {
          id: 'call-1',
          toolId: 'fs-server:read',
          role: 'code-reviewer',
          actorId: 'coding-agent',
          args: {},
        },
        executor,
        { now: NOW },
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe('TOOL_NOT_ALLOWED');
    expect(executor).not.toHaveBeenCalled();
  });

  it('executes immediately and records one audited event when no approval is needed', async () => {
    ({ temp, log } = await setup());
    const executor: ToolExecutor = vi.fn(async () => ({
      result: { ok: true },
      cost: 0.02,
    }));
    const outcome = await requestToolCall(
      log,
      {
        id: 'call-2',
        toolId: 'fs-server:read',
        role: 'coding-agent',
        actorId: 'coding-agent',
        args: { path: '/tmp/x' },
      },
      executor,
      { now: NOW },
    );

    expect(outcome.status).toBe('completed');
    expect(executor).toHaveBeenCalledTimes(1);
    const calls = listToolCalls(log);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: 'call-2',
      status: 'completed',
      requiresApproval: false,
      cost: 0.02,
      argsDigest: digestOf({ path: '/tmp/x' }),
      resultDigest: digestOf({ ok: true }),
    });
    expect(listPendingApprovals(log)).toEqual([]);
  });

  it('parks an approval card and never calls the executor when requiresApproval is true (AC-2)', async () => {
    ({ temp, log } = await setup());
    const executor = vi.fn<ToolExecutor>();
    const outcome = await requestToolCall(
      log,
      {
        id: 'call-3',
        toolId: 'fs-server:write',
        role: 'coding-agent',
        actorId: 'coding-agent',
        args: { path: '/tmp/x', contents: 'hi' },
      },
      executor,
      { now: NOW },
    );

    expect(outcome.status).toBe('pending');
    expect(executor).not.toHaveBeenCalled();
    expect(listToolCalls(log)).toEqual([]);
    const pending = listPendingApprovals(log);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: 'call-3', status: 'pending' });
  });

  it('resolves a dynamic (shell) tool to requiresApproval=true for a destructive command and parks it', async () => {
    ({ temp, log } = await setup());
    const executor = vi.fn<ToolExecutor>();
    const outcome = await requestToolCall(
      log,
      {
        id: 'call-4',
        toolId: 'fs-server:shell',
        role: 'coding-agent',
        actorId: 'coding-agent',
        args: { command: 'rm -rf /' },
      },
      executor,
      { now: NOW },
    );
    expect(outcome.status).toBe('pending');
    expect(executor).not.toHaveBeenCalled();
  });

  it('resolves a dynamic (shell) tool to requiresApproval=false for a benign command and executes', async () => {
    ({ temp, log } = await setup());
    const executor: ToolExecutor = vi.fn(async () => ({ result: 'ok', cost: 0 }));
    const outcome = await requestToolCall(
      log,
      {
        id: 'call-5',
        toolId: 'fs-server:shell',
        role: 'coding-agent',
        actorId: 'coding-agent',
        args: { command: 'ls -la' },
      },
      executor,
      { now: NOW },
    );
    expect(outcome.status).toBe('completed');
    expect(executor).toHaveBeenCalledTimes(1);
  });
});

describe('decideToolCall (US-503 AC-2, T-14 self-approval guard)', () => {
  let temp: TempDb;
  let log: EventLog;

  afterEach(async () => {
    log.close();
    await temp.cleanup();
  });

  it('denies a parked call without ever invoking the executor', async () => {
    ({ temp, log } = await setup());
    const requestExecutor = vi.fn<ToolExecutor>();
    await requestToolCall(
      log,
      {
        id: 'call-6',
        toolId: 'fs-server:write',
        role: 'coding-agent',
        actorId: 'coding-agent',
        args: { path: '/tmp/x' },
      },
      requestExecutor,
      { now: NOW },
    );

    const decideExecutor = vi.fn<ToolExecutor>();
    const outcome = await decideToolCall(
      log,
      { id: 'call-6', decision: 'denied', decidedBy: 'human-1' },
      decideExecutor,
      { now: LATER },
    );

    expect(outcome.status).toBe('denied');
    expect(decideExecutor).not.toHaveBeenCalled();
    expect(requestExecutor).not.toHaveBeenCalled();
    const calls = listToolCalls(log);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'call-6', status: 'denied', cost: 0 });
    expect(listPendingApprovals(log)).toEqual([]);
  });

  it('approves a parked call, executes it exactly once, and records the audited completion', async () => {
    ({ temp, log } = await setup());
    await requestToolCall(
      log,
      {
        id: 'call-7',
        toolId: 'fs-server:write',
        role: 'coding-agent',
        actorId: 'coding-agent',
        args: { path: '/tmp/x', contents: 'hello' },
      },
      vi.fn<ToolExecutor>(),
      { now: NOW },
    );

    const executor: ToolExecutor = vi.fn(async () => ({
      result: { bytesWritten: 5 },
      cost: 0.01,
    }));
    const outcome = await decideToolCall(
      log,
      { id: 'call-7', decision: 'approved', decidedBy: 'human-1' },
      executor,
      { now: LATER },
    );

    expect(outcome.status).toBe('completed');
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({ args: { path: '/tmp/x', contents: 'hello' } }),
    );
    const calls = listToolCalls(log);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: 'call-7',
      status: 'completed',
      requiresApproval: true,
      cost: 0.01,
      resultDigest: digestOf({ bytesWritten: 5 }),
    });
  });

  it('refuses self-approval (requester === decider)', async () => {
    ({ temp, log } = await setup());
    await requestToolCall(
      log,
      {
        id: 'call-8',
        toolId: 'fs-server:write',
        role: 'coding-agent',
        actorId: 'coding-agent',
        args: {},
      },
      vi.fn<ToolExecutor>(),
      { now: NOW },
    );

    const executor = vi.fn<ToolExecutor>();
    let error: unknown;
    try {
      await decideToolCall(
        log,
        { id: 'call-8', decision: 'approved', decidedBy: 'coding-agent' },
        executor,
        { now: LATER },
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe('SELF_APPROVAL');
    expect(executor).not.toHaveBeenCalled();
    expect(getPendingApproval(log, 'call-8')?.status).toBe('pending');
  });

  it('refuses to decide an approval twice', async () => {
    ({ temp, log } = await setup());
    await requestToolCall(
      log,
      {
        id: 'call-9',
        toolId: 'fs-server:write',
        role: 'coding-agent',
        actorId: 'coding-agent',
        args: {},
      },
      vi.fn<ToolExecutor>(),
      { now: NOW },
    );
    await decideToolCall(
      log,
      { id: 'call-9', decision: 'denied', decidedBy: 'human-1' },
      undefined,
      { now: LATER },
    );

    let error: unknown;
    try {
      await decideToolCall(
        log,
        { id: 'call-9', decision: 'approved', decidedBy: 'human-2' },
        vi.fn<ToolExecutor>(),
        { now: LATER },
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe('APPROVAL_NOT_PENDING');
  });

  it('requires an executor to approve', async () => {
    ({ temp, log } = await setup());
    await requestToolCall(
      log,
      {
        id: 'call-10',
        toolId: 'fs-server:write',
        role: 'coding-agent',
        actorId: 'coding-agent',
        args: {},
      },
      vi.fn<ToolExecutor>(),
      { now: NOW },
    );
    let error: unknown;
    try {
      await decideToolCall(
        log,
        { id: 'call-10', decision: 'approved', decidedBy: 'human-1' },
        undefined,
        { now: LATER },
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe('EXECUTOR_REQUIRED');
  });

  it('executes the approved path with log-redacted args, never the raw secret (law 8)', async () => {
    ({ temp, log } = await setup());
    const secretArgs = { command: 'echo', token: 'sk-abcdefghijklmnopqrstuvwx' };
    await requestToolCall(
      log,
      {
        id: 'call-11',
        toolId: 'fs-server:write',
        role: 'coding-agent',
        actorId: 'coding-agent',
        args: secretArgs,
      },
      vi.fn<ToolExecutor>(),
      { now: NOW },
    );

    // The stored card already redacted the secret-shaped value (appendEvent -> redactDeep).
    const pending = getPendingApproval(log, 'call-11');
    expect(pending?.args).not.toEqual(secretArgs);
    expect(JSON.stringify(pending?.args)).not.toContain('sk-abcdefghijklmnopqrstuvwx');

    const executor: ToolExecutor = vi.fn(async ({ args }) => ({ result: args, cost: 0 }));
    await decideToolCall(
      log,
      { id: 'call-11', decision: 'approved', decidedBy: 'human-1' },
      executor,
      { now: LATER },
    );

    // The executor received the same redacted copy — never the raw secret.
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({ args: pending?.args }),
    );
    const receivedArgs = vi.mocked(executor).mock.calls[0]?.[0]?.args;
    expect(JSON.stringify(receivedArgs)).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });

  it('leaves the card pending (retryable) when the executor throws, appending no events', async () => {
    ({ temp, log } = await setup());
    await requestToolCall(
      log,
      {
        id: 'call-12',
        toolId: 'fs-server:write',
        role: 'coding-agent',
        actorId: 'coding-agent',
        args: {},
      },
      vi.fn<ToolExecutor>(),
      { now: NOW },
    );

    const failingExecutor: ToolExecutor = vi.fn(async () => {
      throw new Error('server unreachable');
    });
    await expect(
      decideToolCall(
        log,
        { id: 'call-12', decision: 'approved', decidedBy: 'human-1' },
        failingExecutor,
        { now: LATER },
      ),
    ).rejects.toThrow('server unreachable');

    // Still pending — no `approval.decided` and no terminal `mcp.tool_call.*` event was appended.
    expect(getPendingApproval(log, 'call-12')?.status).toBe('pending');
    expect(listToolCalls(log)).toEqual([]);

    // Retry succeeds once the executor works.
    const okExecutor: ToolExecutor = vi.fn(async () => ({ result: 'ok', cost: 0 }));
    const outcome = await decideToolCall(
      log,
      { id: 'call-12', decision: 'approved', decidedBy: 'human-1' },
      okExecutor,
      { now: LATER },
    );
    expect(outcome.status).toBe('completed');
  });
});
