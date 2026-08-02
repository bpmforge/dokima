import { describe, expect, it } from 'vitest';
import { getIdentity, openEventLog, type EventLog } from '@dokima/events';
import {
  assertVerifierDistinctFromAuthor,
  ensurePhaseGateVerifierIdentity,
  PHASE_GATE_VERIFIER_ACTOR_ID,
  PhaseGateMissingAuthorIdentityError,
  PhaseGateSameIdentityError,
} from './identity.js';

describe('assertVerifierDistinctFromAuthor (W9-06, Law 5 red fixture)', () => {
  it('refuses a same-identity mint — author and verifier are the literal same string', () => {
    expect(() =>
      assertVerifierDistinctFromAuthor(
        3,
        'specialist:architecture-designer',
        'specialist:architecture-designer',
      ),
    ).toThrow(PhaseGateSameIdentityError);
  });

  it('refuses a same-identity mint even under whitespace padding (mechanical, not string-literal)', () => {
    expect(() =>
      assertVerifierDistinctFromAuthor(3, ' phase-gate-runner ', 'phase-gate-runner'),
    ).toThrow(PhaseGateSameIdentityError);
  });

  it('refuses a blank authorActorId outright — an omitted author would make the guard vacuous', () => {
    expect(() => assertVerifierDistinctFromAuthor(0, '', 'phase-gate-runner')).toThrow(
      PhaseGateMissingAuthorIdentityError,
    );
    expect(() => assertVerifierDistinctFromAuthor(0, '   ', 'phase-gate-runner')).toThrow(
      PhaseGateMissingAuthorIdentityError,
    );
  });

  it('allows distinct identities through', () => {
    expect(() =>
      assertVerifierDistinctFromAuthor(
        0,
        'specialist:pm-interviewer',
        'phase-gate-runner',
      ),
    ).not.toThrow();
  });
});

describe('ensurePhaseGateVerifierIdentity', () => {
  it('creates the verifier identity as a machine identity, idempotently', () => {
    const log: EventLog = openEventLog(':memory:');
    try {
      expect(getIdentity(log, PHASE_GATE_VERIFIER_ACTOR_ID)).toBeUndefined();
      ensurePhaseGateVerifierIdentity(log);
      const identity = getIdentity(log, PHASE_GATE_VERIFIER_ACTOR_ID);
      expect(identity?.kind).toBe('machine');
      // Second call must not throw (identities are UPDATE/DELETE-blocked — a naive
      // re-create would hit the append-only identities table's triggers).
      expect(() => ensurePhaseGateVerifierIdentity(log)).not.toThrow();
    } finally {
      log.close();
    }
  });
});
