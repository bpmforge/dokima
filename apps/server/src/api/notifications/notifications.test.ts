import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@shipwright/events';
import type { Ticket, TicketHistoryEntry } from '@shipwright/tickets';
import {
  computeTrustGraduationEvidence,
  decideNotification,
  DEFAULT_QUIET_HOURS,
  dismissNotification,
  emitNotification,
  emitReviewItem,
  evaluatePushPromotion,
  isIdleBlocked,
  isWithinQuietHours,
  LEVERAGE_BY_KIND,
  listNotifications,
  maybeEmitTrustGraduationSuggestion,
  NotificationNotFoundError,
  NotificationTaxonomyError,
  promoteEligibleNotifications,
  trustGraduationThresholdsCrossed,
} from './index.js';

const NOW = () => '2026-07-18T12:00:00.000Z';

async function tmpDbPath(): Promise<{ dbPath: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-notifications-'));
  return {
    dbPath: path.join(dir, 'state.db'),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

function seedOperator(log: EventLog): void {
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'human' }, { now: NOW });
}

function ticket(overrides: Partial<Ticket> & { id: string }): Ticket {
  return {
    type: 'task',
    title: overrides.id,
    lane: 'ui',
    ownerId: null,
    status: 'ready',
    interface: null,
    writeScope: ['a/**'],
    dependsOn: [],
    acceptance: [],
    verify: null,
    manifest: null,
    history: [],
    evidence: [],
    claimedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function historyEntry(verb: TicketHistoryEntry['verb'], at: string): TicketHistoryEntry {
  return { verb, actorId: 'agent-1', at };
}

describe('notifications core (FR-N4, US-704, DATABASE.md §3)', () => {
  let log: EventLog;
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    log?.close();
    await cleanup?.();
    cleanup = undefined;
  });

  async function boot(): Promise<void> {
    const temp = await tmpDbPath();
    cleanup = temp.cleanup;
    log = openEventLog(temp.dbPath);
    seedOperator(log);
  }

  describe('emitNotification', () => {
    it('US-704 AC-1: rejects an unclassified (invalid tier) notification at the API/type boundary', async () => {
      await boot();
      expect(() =>
        emitNotification(
          log,
          {
            id: 'n-1',
            // Simulates a caller crossing the HTTP boundary with `unknown` input.
            tier: 'urgent' as unknown as 'decide',
            kind: 'approval',
            title: 'x',
            actorId: 'operator',
          },
          { now: NOW },
        ),
      ).toThrow(NotificationTaxonomyError);
    });

    it('rejects an invalid kind', async () => {
      await boot();
      expect(() =>
        emitNotification(
          log,
          {
            id: 'n-1',
            tier: 'decide',
            kind: 'urgent' as unknown as 'approval',
            title: 'x',
            actorId: 'operator',
          },
          { now: NOW },
        ),
      ).toThrow(NotificationTaxonomyError);
    });

    it('persists the row and an anchoring notification.emitted event atomically, defaulting leverage by kind', async () => {
      await boot();
      const record = emitNotification(
        log,
        {
          id: 'n-1',
          tier: 'decide',
          kind: 'approval',
          title: 'Merge W4-07',
          body: { diffStat: '+10 -2' },
          actorId: 'operator',
        },
        { now: NOW },
      );
      expect(record).toMatchObject({
        id: 'n-1',
        tier: 'decide',
        kind: 'approval',
        status: 'open',
        leverage: LEVERAGE_BY_KIND.approval,
        pushedAt: null,
        createdAt: NOW(),
      });
      const [row] = listNotifications(log);
      expect(row).toMatchObject({ id: 'n-1', status: 'open' });
    });

    it('never sets status other than open — Record never pops by construction', async () => {
      await boot();
      const record = emitNotification(
        log,
        {
          id: 'n-1',
          tier: 'record',
          kind: 'gate_passed',
          title: 'x',
          actorId: 'operator',
        },
        { now: NOW },
      );
      expect(record.status).toBe('open');
      expect(record.pushedAt).toBeNull();
    });
  });

  describe('listNotifications', () => {
    it('filters by tier and status, orders by leverage or recency', async () => {
      await boot();
      emitNotification(
        log,
        {
          id: 'n-approval',
          tier: 'decide',
          kind: 'approval',
          title: 'a',
          actorId: 'operator',
        },
        { now: () => '2026-07-18T10:00:00.000Z' },
      );
      emitNotification(
        log,
        {
          id: 'n-clarify',
          tier: 'decide',
          kind: 'clarification',
          title: 'c',
          actorId: 'operator',
        },
        { now: () => '2026-07-18T11:00:00.000Z' },
      );

      const decideOnly = listNotifications(log, { tier: 'decide' });
      expect(decideOnly.map((n) => n.id)).toEqual(['n-clarify', 'n-approval']); // recency default (created_at DESC)

      const byLeverage = listNotifications(log, { orderBy: 'leverage' });
      expect(byLeverage.map((n) => n.id)).toEqual(['n-approval', 'n-clarify']); // approval (30) > clarification (20)
    });
  });

  describe('emitReviewItem — Review batches into digests (UX_SPEC §7)', () => {
    it('creates a single digest on first item, then coalesces subsequent items into it', async () => {
      await boot();
      const first = emitReviewItem(
        log,
        { kind: 'gate_passed', title: 'Gate A passed', summary: 'all validators green' },
        { id: 'digest-1', actorId: 'operator', now: () => '2026-07-18T09:00:00.000Z' },
      );
      expect(first.kind).toBe('digest');
      expect(first.tier).toBe('review');
      expect((first.body as { items: unknown[] }).items).toHaveLength(1);

      const second = emitReviewItem(
        log,
        { kind: 'pr_ready', title: 'PR ready', summary: 'branch pushed' },
        { id: 'digest-2', actorId: 'operator', now: () => '2026-07-18T09:05:00.000Z' },
      );
      expect(second.id).toBe('digest-1'); // absorbed into the existing open digest, not a new row
      expect((second.body as { items: unknown[] }).items).toHaveLength(2);
      expect(second.leverage).toBe(LEVERAGE_BY_KIND.pr_ready); // max() of batched items' leverage

      const rows = listNotifications(log, { tier: 'review' });
      expect(rows).toHaveLength(1); // "one notification per batch"
    });

    it('starts a fresh batch once the open digest is resolved', async () => {
      await boot();
      emitReviewItem(
        log,
        { kind: 'gate_passed', title: 'first', summary: 's' },
        { id: 'digest-1', actorId: 'operator', now: NOW },
      );
      dismissNotification(log, 'digest-1', { actorId: 'operator', now: NOW });

      const fresh = emitReviewItem(
        log,
        { kind: 'gate_passed', title: 'second', summary: 's' },
        { id: 'digest-2', actorId: 'operator', now: NOW },
      );
      expect(fresh.id).toBe('digest-2');
      const open = listNotifications(log, { tier: 'review', status: 'open' });
      expect(open).toHaveLength(1);
    });
  });

  describe('dismissNotification / decideNotification', () => {
    it('transitions status and sets resolvedAt', async () => {
      await boot();
      emitNotification(
        log,
        { id: 'n-1', tier: 'review', kind: 'digest', title: 'x', actorId: 'operator' },
        { now: NOW },
      );
      dismissNotification(log, 'n-1', { actorId: 'operator', now: NOW });
      const [row] = listNotifications(log, { status: 'dismissed' });
      expect(row).toMatchObject({ id: 'n-1', status: 'dismissed', resolvedAt: NOW() });
    });

    it('decideNotification records approved/rejected and resolves as done', async () => {
      await boot();
      emitNotification(
        log,
        { id: 'n-1', tier: 'decide', kind: 'approval', title: 'x', actorId: 'operator' },
        { now: NOW },
      );
      decideNotification(log, 'n-1', 'approved', { actorId: 'operator', now: NOW });
      const [row] = listNotifications(log, { status: 'done' });
      expect(row?.status).toBe('done');
    });

    it('throws NotificationNotFoundError for a missing or already-resolved id', async () => {
      await boot();
      expect(() =>
        dismissNotification(log, 'does-not-exist', { actorId: 'operator', now: NOW }),
      ).toThrow(NotificationNotFoundError);

      emitNotification(
        log,
        { id: 'n-1', tier: 'review', kind: 'digest', title: 'x', actorId: 'operator' },
        { now: NOW },
      );
      dismissNotification(log, 'n-1', { actorId: 'operator', now: NOW });
      expect(() =>
        dismissNotification(log, 'n-1', { actorId: 'operator', now: NOW }),
      ).toThrow(NotificationNotFoundError);
    });
  });

  describe('isWithinQuietHours', () => {
    it('holds within a same-day window', () => {
      expect(
        isWithinQuietHours(new Date('2026-07-18T13:00:00'), {
          startHour: 9,
          endHour: 17,
        }),
      ).toBe(true);
      expect(
        isWithinQuietHours(new Date('2026-07-18T08:00:00'), {
          startHour: 9,
          endHour: 17,
        }),
      ).toBe(false);
    });

    it('wraps midnight for the default 22:00-07:00 window', () => {
      expect(
        isWithinQuietHours(new Date('2026-07-18T23:00:00'), DEFAULT_QUIET_HOURS),
      ).toBe(true);
      expect(
        isWithinQuietHours(new Date('2026-07-18T03:00:00'), DEFAULT_QUIET_HOURS),
      ).toBe(true);
      expect(
        isWithinQuietHours(new Date('2026-07-18T12:00:00'), DEFAULT_QUIET_HOURS),
      ).toBe(false);
    });

    it('a zero-width window (start === end) is never quiet', () => {
      expect(
        isWithinQuietHours(new Date('2026-07-18T23:00:00'), { startHour: 5, endHour: 5 }),
      ).toBe(false);
    });
  });

  describe('isIdleBlocked', () => {
    it('false for an empty board — no run to be blocked on', () => {
      expect(isIdleBlocked([])).toBe(false);
    });

    it('false when at least one ticket is claimable', () => {
      expect(isIdleBlocked([ticket({ id: 'T-1', status: 'ready' })])).toBe(false);
    });

    it('true when nothing is claimable (all done/blocked/owned)', () => {
      expect(
        isIdleBlocked([
          ticket({ id: 'T-1', status: 'done', closedAt: NOW() }),
          ticket({ id: 'T-2', status: 'ready', dependsOn: ['T-missing'] }),
          ticket({ id: 'T-3', status: 'ready', ownerId: 'agent-1' }),
        ]),
      ).toBe(true);
    });
  });

  describe('evaluatePushPromotion (FR-N4 interrupt-when-idle-blocked + quiet hours)', () => {
    const base = {
      tier: 'decide' as const,
      pushedAt: null,
      idleBlocked: true,
      now: new Date('2026-07-18T12:00:00'),
    };

    it('never promotes a non-decide tier', () => {
      expect(evaluatePushPromotion({ ...base, tier: 'review' }).reason).toBe(
        'not-decide-tier',
      );
      expect(evaluatePushPromotion({ ...base, tier: 'record' }).reason).toBe(
        'not-decide-tier',
      );
    });

    it('does not re-promote an already-pushed notification', () => {
      expect(
        evaluatePushPromotion({ ...base, pushedAt: '2026-07-18T10:00:00.000Z' }).reason,
      ).toBe('already-pushed');
    });

    it('queues (never pushes) when not idle-blocked', () => {
      const result = evaluatePushPromotion({ ...base, idleBlocked: false });
      expect(result).toEqual({ push: false, reason: 'not-idle-blocked' });
    });

    it('queues under quiet hours even when idle-blocked — run continues under auto policy', () => {
      const result = evaluatePushPromotion({
        ...base,
        now: new Date('2026-07-18T23:30:00'),
      });
      expect(result).toEqual({ push: false, reason: 'quiet-hours' });
    });

    it('promotes when decide-tier, unpromoted, idle-blocked, and outside quiet hours', () => {
      expect(evaluatePushPromotion(base)).toEqual({ push: true, reason: 'promoted' });
    });
  });

  describe('promoteEligibleNotifications', () => {
    it('promotes eligible open decide notifications and skips ineligible ones', async () => {
      await boot();
      emitNotification(
        log,
        {
          id: 'n-decide',
          tier: 'decide',
          kind: 'approval',
          title: 'x',
          actorId: 'operator',
        },
        { now: () => '2026-07-18T12:00:00.000Z' },
      );
      emitNotification(
        log,
        {
          id: 'n-review',
          tier: 'review',
          kind: 'digest',
          title: 'y',
          actorId: 'operator',
        },
        { now: () => '2026-07-18T12:00:00.000Z' },
      );
      const idleBlockedTickets = [ticket({ id: 'T-1', status: 'done', closedAt: NOW() })];

      const promoted = promoteEligibleNotifications(log, idleBlockedTickets, {
        actorId: 'operator',
        now: () => '2026-07-18T12:30:00.000Z',
      });
      expect(promoted.map((n) => n.id)).toEqual(['n-decide']);

      const [decideRow] = listNotifications(log, { tier: 'decide' });
      expect(decideRow?.pushedAt).toBe('2026-07-18T12:30:00.000Z');

      // Idempotent: a second call does not re-promote or duplicate.
      const again = promoteEligibleNotifications(log, idleBlockedTickets, {
        actorId: 'operator',
        now: () => '2026-07-18T12:45:00.000Z',
      });
      expect(again).toHaveLength(0);
    });

    it('does not promote while claimable work remains (not idle-blocked)', async () => {
      await boot();
      emitNotification(
        log,
        {
          id: 'n-decide',
          tier: 'decide',
          kind: 'approval',
          title: 'x',
          actorId: 'operator',
        },
        { now: NOW },
      );
      const promoted = promoteEligibleNotifications(
        log,
        [ticket({ id: 'T-1', status: 'ready' })],
        { actorId: 'operator', now: NOW },
      );
      expect(promoted).toHaveLength(0);
    });
  });

  describe('computeTrustGraduationEvidence (R-A1/US-310)', () => {
    const now = new Date('2026-07-18T12:00:00.000Z');

    it('counts only clean (non-oscillated) closes within the 7-day window', () => {
      const tickets: Ticket[] = [
        ticket({ id: 'T-clean', status: 'done', closedAt: '2026-07-16T00:00:00.000Z' }),
        ticket({
          id: 'T-oscillated',
          status: 'done',
          closedAt: '2026-07-16T00:00:00.000Z',
          history: [historyEntry('release', '2026-07-15T00:00:00.000Z')],
        }),
        ticket({ id: 'T-too-old', status: 'done', closedAt: '2026-07-01T00:00:00.000Z' }),
        ticket({ id: 'T-not-done', status: 'in_progress' }),
      ];
      const evidence = computeTrustGraduationEvidence(tickets, now);
      expect(evidence.cleanCloses).toBe(1);
      expect(evidence.oscillations).toBe(1);
      expect(evidence.unwaivedCriticalsOver7d).toBe(0);
      expect(evidence.windowDays).toBe(7);
    });

    it('lanesAvailable counts distinct lanes with at least one claimable ticket', () => {
      const tickets: Ticket[] = [
        ticket({ id: 'T-1', status: 'ready', lane: 'ui' }),
        ticket({ id: 'T-2', status: 'ready', lane: 'gateway' }),
        ticket({ id: 'T-3', status: 'ready', lane: 'ui' }), // same lane as T-1, not double-counted
        ticket({ id: 'T-4', status: 'ready', lane: 'orchestrator', ownerId: 'agent-1' }), // owned, not claimable
      ];
      expect(computeTrustGraduationEvidence(tickets, now).lanesAvailable).toBe(2);
    });
  });

  describe('trustGraduationThresholdsCrossed', () => {
    const passing = {
      cleanCloses: 10,
      oscillations: 0,
      unwaivedCriticalsOver7d: 0,
      lanesAvailable: 2,
      windowDays: 7,
    };

    it('true only when every threshold is met', () => {
      expect(trustGraduationThresholdsCrossed(passing)).toBe(true);
      expect(trustGraduationThresholdsCrossed({ ...passing, cleanCloses: 9 })).toBe(
        false,
      );
      expect(trustGraduationThresholdsCrossed({ ...passing, oscillations: 1 })).toBe(
        false,
      );
      expect(trustGraduationThresholdsCrossed({ ...passing, lanesAvailable: 1 })).toBe(
        false,
      );
    });
  });

  describe('maybeEmitTrustGraduationSuggestion', () => {
    function cleanCloseTickets(): Ticket[] {
      const closes = Array.from({ length: 10 }, (_, i) =>
        ticket({
          id: `T-close-${i}`,
          status: 'done',
          closedAt: '2026-07-16T00:00:00.000Z',
        }),
      );
      return [
        ...closes,
        ticket({ id: 'T-ready-ui', status: 'ready', lane: 'ui' }),
        ticket({ id: 'T-ready-gateway', status: 'ready', lane: 'gateway' }),
      ];
    }

    it('emits a Record-tier suggestion citing its evidence when thresholds cross', async () => {
      await boot();
      const record = maybeEmitTrustGraduationSuggestion(log, cleanCloseTickets(), {
        id: 'suggestion-1',
        actorId: 'operator',
        now: NOW,
      });
      expect(record).not.toBeNull();
      expect(record?.tier).toBe('record');
      expect(record?.kind).toBe('suggestion');
      expect((record?.body as { evidence: unknown }).evidence).toMatchObject({
        cleanCloses: 10,
        oscillations: 0,
        lanesAvailable: 2,
      });
    });

    it('does not emit when thresholds are not crossed', async () => {
      await boot();
      const record = maybeEmitTrustGraduationSuggestion(
        log,
        [ticket({ id: 'T-1', status: 'done', closedAt: NOW() })],
        { id: 'suggestion-1', actorId: 'operator', now: NOW },
      );
      expect(record).toBeNull();
    });

    it('is idempotent — a second crossing call does not duplicate an open suggestion', async () => {
      await boot();
      maybeEmitTrustGraduationSuggestion(log, cleanCloseTickets(), {
        id: 'suggestion-1',
        actorId: 'operator',
        now: NOW,
      });
      const second = maybeEmitTrustGraduationSuggestion(log, cleanCloseTickets(), {
        id: 'suggestion-2',
        actorId: 'operator',
        now: NOW,
      });
      expect(second).toBeNull();
      expect(
        listNotifications(log, { status: 'open' }).filter((n) => n.kind === 'suggestion'),
      ).toHaveLength(1);
    });
  });
});
