import { describe, expect, it } from 'vitest';
import type { Ticket } from '@dokima/tickets';
import {
  DEFAULT_VERIFY_COMMAND,
  defaultHandoffBuilder,
  TicketRoleRefusedError,
} from './loop-handoff.js';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'W9-01',
    type: 'task',
    title: 'Sample ticket',
    lane: 'core',
    ownerId: null,
    status: 'ready',
    interface: null,
    writeScope: ['packages/example/**'],
    dependsOn: [],
    acceptance: [{ id: 'A1', text: 'does the thing', done: false }],
    verify: null,
    manifest: null,
    history: [],
    evidence: [],
    claimedAt: null,
    claimRunId: null,
    closedAt: null,
    ...overrides,
  };
}

describe('defaultHandoffBuilder', () => {
  it('projects the ticket fields the HANDOFF contract needs', () => {
    const build = defaultHandoffBuilder();
    const handoff = build(
      ticket({
        verify: 'pnpm --filter example test',
        writeScope: ['packages/example/**'],
      }),
    );

    expect(handoff.role).toBe('coding-agent');
    expect(handoff.mission).toBe('Sample ticket');
    expect(handoff.ticket).toEqual({ id: 'W9-01', title: 'Sample ticket' });
    expect(handoff.writeScope).toEqual(['packages/example/**']);
    expect(handoff.produce).toEqual(['does the thing']);
    expect(handoff.verify).toBe('pnpm --filter example test');
  });

  it('falls back to the project full gate when the ticket has no verify command', () => {
    const build = defaultHandoffBuilder();
    const handoff = build(ticket({ verify: null }));
    expect(handoff.verify).toBe(DEFAULT_VERIFY_COMMAND);
  });

  it('uses the interface field for context when present, else the title', () => {
    const build = defaultHandoffBuilder();
    expect(build(ticket({ interface: 'GET /widgets' })).context).toBe('GET /widgets');
    expect(build(ticket({ interface: null })).context).toBe('Sample ticket');
  });

  it('honors an explicit role override', () => {
    const build = defaultHandoffBuilder('code-reviewer');
    expect(build(ticket()).role).toBe('code-reviewer');
  });
});

/**
 * D-025 / W12-06. `content/` ships 93 experts and exactly one has ever been
 * dispatched, because every production call site calls the builder with no
 * role argument and takes the `coding-agent` default.
 */
describe('per-ticket expert selection (W12-06, D-025)', () => {
  it(
    'RED FIXTURE: a ticket that NAMES its expert is dispatched as that expert. ' +
      'The role was bound when the builder was constructed, so it was the same ' +
      'for every ticket in a run — a security ticket and a schema ticket went to ' +
      'the same generalist no matter what the board said',
    () => {
      const build = defaultHandoffBuilder();
      expect(build(ticket({ role: 'security-auditor' })).role).toBe('security-auditor');
    },
  );

  it('a ticket with no role still dispatches as coding-agent — 208 done tickets carry none', () => {
    const build = defaultHandoffBuilder();
    expect(build(ticket()).role).toBe('coding-agent');
    expect(build(ticket({ role: undefined })).role).toBe('coding-agent');
  });

  it(
    'the TICKET wins over the builder default, because the builder default is a ' +
      'run-wide fallback and the ticket is the specific statement. Reversing this ' +
      'would make the field unreachable through createPackedHandoffBuilder, which ' +
      'always passes a role',
    () => {
      const build = defaultHandoffBuilder('coding-agent');
      expect(build(ticket({ role: 'db-architect' })).role).toBe('db-architect');
    },
  );

  it(
    'C-4: a ticket may NOT name a verifier role as the expert that does the work. ' +
      'Ticket-wins is required for the field to be reachable at all, and it is ' +
      'exactly what would let a board row declare the maker to be the reviewer. ' +
      'guardMakerVerifierDistinct cannot catch this — it fires on the verifier ' +
      'side and compares models, by which point the collapse already happened',
    () => {
      const build = defaultHandoffBuilder();
      expect(() => build(ticket({ role: 'code-reviewer' }))).toThrow(
        TicketRoleRefusedError,
      );
      expect(() => build(ticket({ role: 'challenger' }))).toThrow(/C-4/);
    },
  );

  it('refusing names the ticket and the role, because the board is what needs fixing', () => {
    try {
      defaultHandoffBuilder()(ticket({ id: 'W9-42', role: 'code-reviewer' }));
      expect.unreachable('should have refused');
    } catch (err) {
      expect(err).toBeInstanceOf(TicketRoleRefusedError);
      expect((err as TicketRoleRefusedError).ticketId).toBe('W9-42');
      expect((err as TicketRoleRefusedError).role).toBe('code-reviewer');
    }
  });

  it('every OTHER expert is dispatchable — the refusal is narrow, not a whitelist', () => {
    const build = defaultHandoffBuilder();
    for (const role of ['security-auditor', 'db-architect', 'ux-engineer', 'sre-engineer']) {
      expect(build(ticket({ role })).role).toBe(role);
    }
  });
});
