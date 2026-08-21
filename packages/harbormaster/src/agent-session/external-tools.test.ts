import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import {
  loadMcpState,
  registerServer,
  setRoleAllowlist,
  type ToolExecutor,
} from '@dokima/mcp';
import {
  runExternalToolCall,
  type ExternalApprovalDecision,
  type ExternalToolset,
} from './external-tools.js';
import { ensureAgentSessionToolsRegistered, type RunToolCallsAudit } from './mcp-wiring.js';
import type { ToolCall } from './gateway-tool-types.js';

/** W14-03. Law 9(a): executor is a counting fake; no server, no network. */

const dirs: string[] = [];
let openLog: EventLog | undefined;

afterEach(async () => {
  openLog?.close();
  openLog = undefined;
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function setup(): Promise<{ log: EventLog }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-external-tools-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  openLog = log;
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  createIdentity(log, { id: 'human-2', name: 'Approver', kind: 'human' });
  registerServer(log, {
    id: 'srv-x',
    name: 'External X',
    transport: 'stdio',
    tools: [
      { id: 'srv-x.deploy', name: 'deploy', description: null, requiresApproval: true },
    ],
    actorId: 'worker-1',
  });
  setRoleAllowlist(log, {
    role: 'coding-agent',
    toolIds: ['srv-x.deploy'],
    actorId: 'worker-1',
  });
  return { log };
}

function makeToolset(
  executions: unknown[],
  verdict?: ExternalApprovalDecision,
): ExternalToolset {
  const executor: ToolExecutor = async ({ tool, args }) => {
    executions.push({ tool: tool.id, args });
    return { result: { deployed: true }, cost: 0.01 };
  };
  return {
    schemas: [],
    toolIds: new Set(['srv-x.deploy']),
    executor,
    approvalDecision: () => verdict,
  };
}

const CALL: ToolCall = { id: 'tc-1', name: 'srv-x.deploy', arguments: { env: 'prod' } };
const audit = (log: EventLog): RunToolCallsAudit => ({
  log,
  role: 'coding-agent',
  actorId: 'worker-1',
  ticketId: 'T-1',
  runId: 'run-1',
});

describe('runExternalToolCall — the two-phase approval protocol (W14-03)', () => {
  it('RED FIXTURE: a requiresApproval call parks and does NOT execute; the model gets a structured awaiting result naming the queue', async () => {
    const { log } = await setup();
    const executions: unknown[] = [];
    const outcome = (await runExternalToolCall(CALL, audit(log), makeToolset(executions))) as {
      ok: boolean;
      awaitingApproval: boolean;
      approvalId: string;
      note: string;
    };

    expect(executions).toEqual([]); // NOTHING ran
    expect(outcome.awaitingApproval).toBe(true);
    expect(outcome.note).toContain('morning queue');
    const state = loadMcpState(log);
    expect(state.pendingApprovals.get(outcome.approvalId)?.status).toBe('pending');
  });

  it('a re-call with the same arguments while undecided returns the SAME approval — never a second card', async () => {
    const { log } = await setup();
    const executions: unknown[] = [];
    const first = (await runExternalToolCall(CALL, audit(log), makeToolset(executions))) as {
      approvalId: string;
    };
    const second = (await runExternalToolCall(CALL, audit(log), makeToolset(executions))) as {
      approvalId: string;
    };
    expect(second.approvalId).toBe(first.approvalId);
    expect(loadMcpState(log).pendingApprovals.size).toBe(1);
  });

  it("RED FIXTURE: an approved card executes exactly once on the run's executor, with the QUEUE DECIDER as decidedBy — not the session actor (C-4)", async () => {
    const { log } = await setup();
    const executions: unknown[] = [];
    await runExternalToolCall(CALL, audit(log), makeToolset(executions));

    const approved = makeToolset(executions, {
      decision: 'approved',
      decidedBy: 'human-2',
    });
    const outcome = await runExternalToolCall(CALL, audit(log), approved);

    expect(executions).toEqual([{ tool: 'srv-x.deploy', args: { env: 'prod' } }]);
    expect(outcome).toEqual({ deployed: true });
    const record = loadMcpState(log).callLog.find((r) => r.toolId === 'srv-x.deploy');
    expect(record?.status).toBe('completed');
    // The audited approval names the human, not the machine that asked.
    const approval = [...loadMcpState(log).pendingApprovals.values()][0]!;
    expect(approval.decidedBy).toBe('human-2');
    expect(approval.decidedBy).not.toBe('worker-1');
  });

  it('a declined card returns a refusal naming the decider, and never executes', async () => {
    const { log } = await setup();
    const executions: unknown[] = [];
    await runExternalToolCall(CALL, audit(log), makeToolset(executions));
    const denied = makeToolset(executions, { decision: 'denied', decidedBy: 'human-2' });
    const outcome = (await runExternalToolCall(CALL, audit(log), denied)) as {
      ok: boolean;
      refusal: string;
    };
    expect(executions).toEqual([]);
    expect(outcome.ok).toBe(false);
    expect(outcome.refusal).toContain('declined');
    expect(outcome.refusal).toContain('human-2');
  });

  it('RED FIXTURE: the session-start allowlist reset preserves external grants — a granted tool must not be silently revoked every session', async () => {
    const { log } = await setup();
    ensureAgentSessionToolsRegistered(log, { role: 'coding-agent', actorId: 'worker-1' });
    const allowed = loadMcpState(log).allowlist.get('coding-agent');
    expect(allowed?.has('srv-x.deploy')).toBe(true);
    expect(allowed?.has('agent-session.read')).toBe(true);
  });
});
