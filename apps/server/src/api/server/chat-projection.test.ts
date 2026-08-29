/**
 * W13-63. The Chat pane promised "messages, questions, findings, and
 * manifests appear here as agents work" and served registered projects an
 * empty stream forever. These pin the real projection: a park is a finding a
 * person must read, a close is a manifest, and provenance comes from the log.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendEvent, createIdentity, openEventLog } from '@dokima/events';
import { chatEnvelopesForProject, projectChatEnvelopes } from './chat-projection.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function freshLog() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-chatproj-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  return log;
}

describe('projectChatEnvelopes (W13-63)', () => {
  it('RED FIXTURE: a park comment becomes a finding card with provenance from the same log', async () => {
    const log = await freshLog();
    try {
      appendEvent(log, {
        eventType: 'spend.recorded',
        actorId: 'worker-1',
        ticketId: 'PLAN-auth-setup',
        payload: { role: 'coding-agent', model: 'qwen/qwen3-coder-next', costUsd: 0.012 },
      });
      appendEvent(log, {
        eventType: 'spend.recorded',
        actorId: 'worker-1',
        ticketId: 'PLAN-auth-setup',
        payload: { role: 'coding-agent', model: 'qwen/qwen3-coder-next', costUsd: 0.018 },
      });
      appendEvent(log, {
        eventType: 'ticket.commented',
        actorId: 'worker-1',
        ticketId: 'PLAN-auth-setup',
        payload: {
          body: 'Parked with evidence — ladder attempt cap (2) reached without a close (FR-H1/H2).',
        },
      });

      const envelopes = projectChatEnvelopes(log, 'proj-1');

      expect(envelopes[0]!.type).toBe('thread.opened');
      const finding = envelopes.find((e) => e.type === 'card.finding')!;
      expect(finding).toBeDefined();
      const data = finding.data as {
        issue: string;
        severity: string;
        provenance: { agent: string; model: string; ticket_id: string; cost_usd: number };
      };
      expect(data.issue).toContain('Parked with evidence');
      expect(data.severity).toBe('high');
      // FR-C2 provenance, computed not asserted: agent, model, ticket, cost.
      expect(data.provenance.agent).toBe('worker-1');
      expect(data.provenance.model).toBe('qwen/qwen3-coder-next');
      expect(data.provenance.ticket_id).toBe('PLAN-auth-setup');
      expect(data.provenance.cost_usd).toBeCloseTo(0.03);
    } finally {
      log.close();
    }
  });

  it('a close becomes a manifest card; ordinary comments stay OUT — signal, not firehose', async () => {
    const log = await freshLog();
    try {
      appendEvent(log, {
        eventType: 'ticket.commented',
        actorId: 'worker-1',
        ticketId: 'T-1',
        payload: { body: 'just a normal comment' },
      });
      appendEvent(log, {
        eventType: 'ticket.closed',
        actorId: 'worker-1',
        ticketId: 'T-1',
        payload: {
          manifest: { files: ['src/auth.ts', 'src/auth.test.ts'], verify: { exit: 0 } },
        },
      });

      const envelopes = projectChatEnvelopes(log, 'proj-1');
      const kinds = envelopes.map((e) => e.type);
      expect(kinds).toEqual(['thread.opened', 'card.manifest']);
      const data = envelopes[1]!.data as { files: string[]; verify_result: string };
      expect(data.files).toEqual(['src/auth.ts', 'src/auth.test.ts']);
      expect(data.verify_result).toBe('pass');
    } finally {
      log.close();
    }
  });

  it('an empty log is an empty stream — the honest answer for a project that never ran', async () => {
    const log = await freshLog();
    try {
      expect(projectChatEnvelopes(log, 'proj-1')).toEqual([]);
    } finally {
      log.close();
    }
  });
});

/**
 * W21-98, the SAST triage's worked example. `chatEnvelopesForProject` said
 * "Absent DB → empty stream (a project that has never run has no chat —
 * truthfully)" and then caught EVERYTHING from `openEventLog`, so a corrupt
 * database, a permissions error and a schema mismatch all rendered as the
 * same silent "no chat yet".
 *
 * The distinction is one this codebase already draws — `computeProjectStats`
 * re-checks the path and logs anything that is still there and still will not
 * open (W21-77) — so this is not a new idea, it is the same idea applied at a
 * site that had not had it.
 */
describe('chatEnvelopesForProject tells absent from broken (W21-98)', () => {
  it('an absent database is truthfully empty, and says nothing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-chatproj-absent-'));
    dirs.push(dir);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(chatEnvelopesForProject(path.join(dir, 'state.db'), 'p1')).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('RED FIXTURE: a database that IS there and will not open is reported, not swallowed', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-chatproj-broken-'));
    dirs.push(dir);
    // A directory where the database should be: the path exists, so this is
    // not the absent case, and the open fails for a reason a person needs to
    // hear about.
    const dbPath = path.join(dir, 'state.db');
    await fs.mkdir(dbPath);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // It still degrades to empty rather than throwing — the Chat pane must
      // not take the page down (FR-C2) — but it no longer does so in silence.
      expect(chatEnvelopesForProject(dbPath, 'p1')).toEqual([]);
      expect(spy).toHaveBeenCalledOnce();
      expect(String(spy.mock.calls[0]?.[0])).toContain(dbPath);
    } finally {
      spy.mockRestore();
    }
  });
});
