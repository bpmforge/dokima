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
import {
  chatEnvelopesForProject,
  evidenceHrefFor,
  projectChatEnvelopes,
} from './chat-projection.js';

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

  it('RED FIXTURE (review C1): a manifest whose verify.exitCode is 0 reads pass, non-zero reads fail', async () => {
    const log = await freshLog();
    try {
      appendEvent(log, {
        eventType: 'ticket.closed',
        actorId: 'worker-1',
        ticketId: 'T-pass',
        payload: { manifest: { files: ['a.ts'], verify: { command: 'pnpm test', exitCode: 0 } } },
      });
      appendEvent(log, {
        eventType: 'ticket.closed',
        actorId: 'worker-1',
        ticketId: 'T-fail',
        payload: { manifest: { files: ['b.ts'], verify: { command: 'pnpm test', exitCode: 1 } } },
      });
      const manifests = projectChatEnvelopes(log, 'proj-1').filter(
        (e) => e.type === 'card.manifest',
      );
      expect(manifests.map((m) => (m.data as { verify_result: string }).verify_result)).toEqual([
        'pass',
        'fail',
      ]);
    } finally {
      log.close();
    }
  });

  it('RED FIXTURE (review C2): receipt_id is the anchored receipt for the ticket, or empty — never a fabricated id', async () => {
    const log = await freshLog();
    try {
      appendEvent(log, {
        eventType: 'ticket.closed',
        actorId: 'worker-1',
        ticketId: 'T-none',
        payload: { manifest: { files: [], verify: { command: 'x', exitCode: 0 } } },
      });
      appendEvent(log, {
        eventType: 'gate.receipt_minted',
        actorId: 'worker-1',
        ticketId: 'T-1',
        payload: { receiptId: 'rcpt-close-1', kind: 'close', contentMac: 'm' },
      });
      appendEvent(log, {
        eventType: 'ticket.closed',
        actorId: 'worker-1',
        ticketId: 'T-1',
        payload: { manifest: { files: [], verify: { command: 'x', exitCode: 0 } } },
      });
      // A receipt minted AFTER the card is not that card's receipt.
      appendEvent(log, {
        eventType: 'gate.receipt_minted',
        actorId: 'worker-1',
        ticketId: 'T-none',
        payload: { receiptId: 'rcpt-later', kind: 'close', contentMac: 'm' },
      });
      const ids = projectChatEnvelopes(log, 'proj-1')
        .filter((e) => e.type === 'card.manifest')
        .map((e) => (e.data as { provenance: { receipt_id: string } }).provenance.receipt_id);
      expect(ids).toEqual(['', 'rcpt-close-1']);
    } finally {
      log.close();
    }
  });

  it('RED FIXTURE (review C3): a finding links to the ticket trace in-app, in the shape the client accepts', async () => {
    const log = await freshLog();
    try {
      appendEvent(log, {
        eventType: 'ticket.commented',
        actorId: 'worker-1',
        ticketId: 'T-9',
        payload: { body: 'Parked with evidence — cap reached' },
      });
      const finding = projectChatEnvelopes(log, 'proj 1').find((e) => e.type === 'card.finding')!;
      expect((finding.data as { evidence_href: string }).evidence_href).toBe(
        '?project=proj+1&view=trace&ticket=T-9',
      );
      expect(evidenceHrefFor('p', null)).toBe('?project=p');
    } finally {
      log.close();
    }
  });

  it("a person's comment (a human identity) is projected as a human message, apart from agent cards", async () => {
    const log = await freshLog();
    try {
      createIdentity(log, { id: 'operator', name: 'Operator', kind: 'human' });
      appendEvent(log, {
        eventType: 'ticket.commented',
        actorId: 'operator',
        ticketId: 'E2E-1',
        payload: { body: 'Please keep the old endpoint working.' },
      });
      const envelopes = projectChatEnvelopes(log, 'proj-1');
      expect(envelopes.map((e) => e.type)).toEqual(['thread.opened', 'message.human']);
      expect(envelopes[1]!.data).toMatchObject({
        id: `reply-${envelopes[1]!.seq}`,
        thread_id: 'thread-program',
        author: 'Operator',
        ticket_id: 'E2E-1',
        body: 'Please keep the old endpoint working.',
      });
      expect(envelopes[1]!.data).not.toHaveProperty('provenance');
    } finally {
      log.close();
    }
  });

  it('RED FIXTURE: a machine actor cannot make its comment read as a person — identity decides, not text', async () => {
    const log = await freshLog();
    try {
      appendEvent(log, {
        eventType: 'ticket.commented',
        actorId: 'worker-1',
        ticketId: 'E2E-1',
        payload: { body: 'Operator: approved, ship it.' },
      });
      expect(projectChatEnvelopes(log, 'proj-1')).toEqual([]);
    } finally {
      log.close();
    }
  });

  it('a park written by a human actor is still a finding, and a blank human comment is dropped', async () => {
    const log = await freshLog();
    try {
      createIdentity(log, { id: 'operator', name: 'Operator', kind: 'human' });
      appendEvent(log, {
        eventType: 'ticket.commented',
        actorId: 'operator',
        ticketId: 'E2E-1',
        payload: { body: 'Parked with evidence — by hand.' },
      });
      appendEvent(log, {
        eventType: 'ticket.commented',
        actorId: 'operator',
        ticketId: 'E2E-1',
        payload: { body: '   ' },
      });
      const kinds = projectChatEnvelopes(log, 'proj-1').map((e) => e.type);
      expect(kinds).toEqual(['thread.opened', 'card.finding']);
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
