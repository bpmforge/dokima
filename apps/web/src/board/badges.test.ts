import { describe, expect, it } from 'vitest';
import {
  blockedExplanation,
  cardStateClass,
  isParked,
  isStaleBlocked,
  isWaived,
  openBlockers,
  parkSummary,
  STALE_BADGE_LABEL,
  WAIVED_BADGE_LABEL,
} from './badges.js';
import { makeBoardTicket } from './test-helpers.js';

describe('isStaleBlocked', () => {
  it('is true only when status is blocked AND the projection flags it stale', () => {
    const stale = makeBoardTicket({ id: 'W1', status: 'blocked', staleBlocked: true });
    expect(isStaleBlocked(stale)).toBe(true);
  });

  it('is false for a blocked ticket whose blockers are not all done', () => {
    const blocked = makeBoardTicket({ id: 'W1', status: 'blocked', staleBlocked: false });
    expect(isStaleBlocked(blocked)).toBe(false);
  });

  it('is false for a non-blocked ticket even if the flag is somehow set', () => {
    const ready = makeBoardTicket({ id: 'W1', status: 'ready', staleBlocked: true });
    expect(isStaleBlocked(ready)).toBe(false);
  });
});

describe('isWaived', () => {
  it('flags waived-status tickets for the permanent ⚠ badge (NFR-6)', () => {
    expect(isWaived(makeBoardTicket({ id: 'W1', status: 'waived' }))).toBe(true);
    expect(isWaived(makeBoardTicket({ id: 'W1', status: 'done' }))).toBe(false);
  });
});

describe('badge copy', () => {
  it('matches UX_SPEC §4 verbatim', () => {
    expect(STALE_BADGE_LABEL).toBe('STALE — claimable?');
    expect(WAIVED_BADGE_LABEL).toBe('⚠ waived');
  });
});

describe('cardStateClass (W13-52)', () => {
  it('RED FIXTURE: blocked is a shape — a blocked card carries the warning stripe class', () => {
    // UX_AUDIT A-4 measured a Blocked and a Ready card pixel-identical.
    expect(cardStateClass('blocked')).toBe(' surface--blocked');
  });

  it('in_review carries attention — accepting someone else\'s work is always a person (C-4)', () => {
    expect(cardStateClass('in_review')).toBe(' surface--attention');
  });

  it('the quiet states stay quiet: the norm is silence', () => {
    for (const status of ['ready', 'claimed', 'in_progress', 'done', 'waived']) {
      expect(cardStateClass(status)).toBe('');
    }
  });
});

describe('isParked (W13-63)', () => {
  const history = (...entries: { verb: string; body?: string }[]) => entries;

  it('RED FIXTURE: the exact live shape — park comment then release, status ready — reads as parked', () => {
    // Measured on the novice rerun: the run "finished", the ticket sat in
    // Ready unmarked, and the only trace was this comment+release pair.
    expect(
      isParked({
        status: 'ready',
        history: history(
          { verb: 'claim' },
          { verb: 'start' },
          { verb: 'comment', body: 'Parked with evidence — ladder attempt cap (2) reached…' },
          { verb: 'release' },
        ),
      }),
    ).toBe(true);
  });

  it('the old header in existing logs still counts', () => {
    expect(
      isParked({
        status: 'ready',
        history: history(
          { verb: 'comment', body: 'auto-blocked with evidence: ladder attempt cap (2)…' },
          { verb: 'release' },
        ),
      }),
    ).toBe(true);
  });

  it('work resuming after the park clears the mark', () => {
    expect(
      isParked({
        status: 'ready',
        history: history(
          { verb: 'comment', body: 'Parked with evidence — …' },
          { verb: 'release' },
          { verb: 'claim' },
          { verb: 'release' },
        ),
      }),
    ).toBe(false);
  });

  it('an ordinary comment is not a park, and non-ready statuses never carry the mark', () => {
    expect(
      isParked({ status: 'ready', history: history({ verb: 'comment', body: 'hello' }) }),
    ).toBe(false);
    expect(
      isParked({
        status: 'in_progress',
        history: history({ verb: 'comment', body: 'Parked with evidence — …' }),
      }),
    ).toBe(false);
  });
});

describe('openBlockers / blockedExplanation (W13-60)', () => {
  it('names only the unfinished dependencies, and a dangling id counts as open', () => {
    const blocked = makeBoardTicket({
      id: 'T-3',
      status: 'blocked',
      dependsOn: ['T-1', 'T-2', 'GHOST'],
    });
    const all = [
      blocked,
      makeBoardTicket({ id: 'T-1', status: 'done' }),
      makeBoardTicket({ id: 'T-2', status: 'in_progress' }),
    ];
    expect(openBlockers(blocked, all)).toEqual(['T-2', 'GHOST']);
  });

  it('RED FIXTURE: the blocked card copy says what it waits on and that opening is automatic — blocked has no exit verb, so without this the state is a dead end', () => {
    const line = blockedExplanation(['T-2']);
    expect(line).toContain('Blocked on T-2');
    expect(line).toContain('on its own');
    expect(blockedExplanation([])).toContain('on its own');
  });
});

describe('the park reason clamps on a word (W18-07)', () => {
  const longEvidence =
    'Parked with evidence — ladder attempt cap (2) reached without a close.\n' +
    'attempt 1/2: exitCode=1 no completion manifest returned — agent session ' +
    'stopped: exceeded the per-session tool-iteration budget (12) without a ' +
    'Completion Manifest (T-27) and this tail keeps going well past the clamp';

  it('RED FIXTURE: never ends mid-word — the live face read "…without a Completion"', () => {
    const park = parkSummary({
      status: 'ready',
      history: [{ verb: 'comment', body: longEvidence }, { verb: 'release' }],
    });
    expect(park).not.toBeNull();
    expect(park!.reason.endsWith('…')).toBe(true);
    const lastWord = park!.reason.slice(0, -1).trimEnd().split(' ').at(-1) ?? '';
    expect(park!.fullReason).toContain(`${lastWord} `);
    expect(park!.fullReason.startsWith('exitCode=1')).toBe(true);
  });

  it('a short reason passes through whole, no ellipsis', () => {
    const park = parkSummary({
      status: 'ready',
      history: [
        { verb: 'comment', body: 'Parked with evidence — cap.\nattempt 1/2: short' },
        { verb: 'release' },
      ],
    });
    expect(park!.reason).toBe('short');
    expect(park!.fullReason).toBe('short');
  });
});
