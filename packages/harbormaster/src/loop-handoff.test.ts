import { describe, expect, it } from 'vitest';
import type { Ticket } from '@dokima/tickets';
import {
  DEFAULT_VERIFY_COMMAND,
  defaultHandoffBuilder,
  TicketRoleRefusedError,
  withFeedback,
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

describe('the evidence travels beside the diagnosis (W21-73)', () => {
  const checkpoint = {
    completed: ['wrote the KDF wrapper'],
    remaining: ['add type: module to package.json to fix ES module error'],
    next: 'add type: module to package.json to fix ES module error',
    worktreeChanged: ['src/crypto/argon2id.ts'],
    claimMismatch: false,
  };

  it('RED FIXTURE: run 52 — the observed failure sits next to the wrong `next`', () => {
    // The maker wrote a confident sentence blaming package.json. The real
    // failure was ERR_CRYPTO_INVALID_SCRYPT_PARAMS, and the product had
    // already run the command and held that output. The successor received
    // the sentence and none of the text that contradicts it, then spent forty
    // turns — the hard ceiling — on the wrong problem.
    const rendered = withFeedback('build the KDF', {
      attempt: 2,
      gaps: ['no Completion Manifest was returned'],
      checkpoint,
      gateEvidence: [
        'acceptance AC-1 failed: `node --test src/crypto/argon2id.spec.ts` exited 1',
        'ERR_CRYPTO_INVALID_SCRYPT_PARAMS: Invalid scrypt params',
      ],
    });
    expect(rendered).toContain('ERR_CRYPTO_INVALID_SCRYPT_PARAMS');
    expect(rendered).toContain('OBSERVED when this ticket was last checked');
    // Both present, so the contradiction is visible to the reader.
    expect(rendered).toContain('type: module');
  });

  it('is rendered as observation, never as a step to perform (acceptance 3)', () => {
    const rendered = withFeedback('build it', {
      attempt: 2,
      gaps: [],
      checkpoint,
      gateEvidence: ['ERR_CRYPTO_INVALID_SCRYPT_PARAMS'],
    });
    expect(rendered).toContain('verbatim output, not a step to perform');
    expect(rendered).toContain('the observation is what actually happened');
  });

  it('a ticket with no prior gate output is unchanged (acceptance 2)', () => {
    const withEvidence = withFeedback('build it', { attempt: 2, gaps: [], checkpoint });
    expect(withEvidence).not.toContain('OBSERVED when this ticket');
  });

  it('an empty evidence list adds nothing', () => {
    const rendered = withFeedback('build it', {
      attempt: 2,
      gaps: [],
      checkpoint,
      gateEvidence: [],
    });
    expect(rendered).not.toContain('OBSERVED when this ticket');
  });
});

/**
 * W22-10. W21-73 attached the gate's real output to a CHECKPOINT, because
 * every case it was written from was a budget-stopped attempt inside one run.
 * A run that starts fresh has no checkpoint at all, so the block never
 * rendered — and the first session of every new run met the ticket with
 * nothing observed beside it, which is the same defect one level out.
 */
describe('the last gate output reaches a run that has no attempt of its own (W22-10)', () => {
  const EVIDENCE = ['verify exited 1: 7 passing, 3 failing', '  at src/auth.test.ts:12'];

  it('RED FIXTURE: a first session in a new run — no checkpoint, no gaps — is still shown what the gate observed', () => {
    const rendered = withFeedback('CONTEXT', { attempt: 0, gaps: [], gateEvidence: EVIDENCE });
    expect(rendered).toContain('OBSERVED when this ticket was last checked');
    expect(rendered).toContain('verify exited 1: 7 passing, 3 failing');
    expect(rendered).toContain('  at src/auth.test.ts:12');
  });

  it('A2: it is rendered as observation, and claims no attempt that did not happen', () => {
    const rendered = withFeedback('CONTEXT', { attempt: 0, gaps: [], gateEvidence: EVIDENCE });
    expect(rendered).toContain('verbatim output, not a step to perform');
    // The "PREVIOUS ATTEMPT (n)" line belongs to gaps. A fresh run has none,
    // and announcing attempt 0 would be the "attempt 5/2" class of lie.
    expect(rendered).not.toContain('PREVIOUS ATTEMPT');
    expect(rendered).not.toContain('RAN OUT OF BUDGET');
  });

  it('A3: with nothing observed, the handoff is untouched', () => {
    expect(withFeedback('CONTEXT', { attempt: 0, gaps: [] })).toBe('CONTEXT');
    expect(withFeedback('CONTEXT', { attempt: 0, gaps: [], gateEvidence: [] })).toBe('CONTEXT');
  });

  it('with a checkpoint the evidence still leads it — W21-73 unchanged', () => {
    const rendered = withFeedback('CONTEXT', {
      attempt: 2,
      gaps: [],
      gateEvidence: EVIDENCE,
      checkpoint: {
        completed: [],
        remaining: [],
        next: 'add type: module to package.json',
        worktreeChanged: [],
        claimMismatch: false,
      },
    });
    expect(rendered.indexOf('OBSERVED when this ticket')).toBeLessThan(
      rendered.indexOf('RAN OUT OF BUDGET'),
    );
    // And exactly once — not one copy per branch.
    expect(rendered.split('OBSERVED when this ticket').length - 1).toBe(1);
  });
});
