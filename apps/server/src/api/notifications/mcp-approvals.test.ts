import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { registerServer, requestToolCall, setRoleAllowlist } from '@dokima/mcp';
import { decideNotification } from './resolve.js';
import {
  mcpApprovalDecision,
  notificationIdForApproval,
  syncMcpApprovalNotifications,
} from './mcp-approvals.js';

const dirs: string[] = [];
let openLog: EventLog | undefined;
afterEach(async () => {
  openLog?.close();
  openLog = undefined;
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function setupWithPending(): Promise<{ log: EventLog; approvalId: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-mcp-cards-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  openLog = log;
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'human' });
  createIdentity(log, { id: 'worker-1', name: 'Worker', kind: 'machine' });
  registerServer(log, {
    id: 'srv-x',
    name: 'External X',
    transport: 'stdio',
    tools: [
      { id: 'srv-x.deploy', name: 'deploy', description: null, requiresApproval: true },
    ],
    actorId: 'operator',
  });
  setRoleAllowlist(log, {
    role: 'coding-agent',
    toolIds: ['srv-x.deploy'],
    actorId: 'operator',
  });
  const outcome = await requestToolCall(
    log,
    {
      id: 'appr-1',
      toolId: 'srv-x.deploy',
      role: 'coding-agent',
      actorId: 'worker-1',
      args: { env: 'prod' },
      ticketId: 'T-1',
      runId: 'run-1',
    },
    async () => ({ result: null, cost: 0 }),
  );
  if (outcome.status !== 'pending') throw new Error('fixture expected a pending approval');
  return { log, approvalId: outcome.approval.id };
}

describe('MCP approval <-> morning queue bridge (W14-03)', () => {
  it('RED FIXTURE: a pending approval becomes exactly one Decide card, idempotently, carrying the evidence (server, tool, args)', async () => {
    const { log, approvalId } = await setupWithPending();

    const first = syncMcpApprovalNotifications(log, 'operator');
    expect(first).toEqual([notificationIdForApproval(approvalId)]);
    const again = syncMcpApprovalNotifications(log, 'operator');
    expect(again).toEqual([]); // one card per approval, ever

    const row = log.db
      .prepare<[string], { tier: string; kind: string; body: string }>(
        'SELECT tier, kind, body FROM notifications WHERE id = ?',
      )
      .get(notificationIdForApproval(approvalId));
    expect(row?.tier).toBe('decide');
    expect(row?.kind).toBe('approval');
    const body = JSON.parse(row!.body) as Record<string, unknown>;
    expect(body.serverId).toBe('srv-x');
    expect(body.toolId).toBe('srv-x.deploy');
    expect(body.args).toEqual({ env: 'prod' });
  });

  it("the card's verdict reads back with WHO decided — approved and rejected both, undefined while open", async () => {
    const { log, approvalId } = await setupWithPending();
    syncMcpApprovalNotifications(log, 'operator');

    expect(mcpApprovalDecision(log, approvalId)).toBeUndefined();

    decideNotification(log, notificationIdForApproval(approvalId), 'approved', {
      actorId: 'operator',
    });
    expect(mcpApprovalDecision(log, approvalId)).toEqual({
      decision: 'approved',
      decidedBy: 'operator',
    });
  });

  it('a rejected card reads back as denied', async () => {
    const { log, approvalId } = await setupWithPending();
    syncMcpApprovalNotifications(log, 'operator');
    decideNotification(log, notificationIdForApproval(approvalId), 'rejected', {
      actorId: 'operator',
    });
    expect(mcpApprovalDecision(log, approvalId)).toEqual({
      decision: 'denied',
      decidedBy: 'operator',
    });
  });
});
