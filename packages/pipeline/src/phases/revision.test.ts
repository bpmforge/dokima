import { describe, expect, it } from 'vitest';
import { getPhase } from './topology.js';
import { UnknownDeliverableError, requestRevision } from './revision.js';

describe('requestRevision (FR-C8/R-H2)', () => {
  it('emits a revision.requested event carrying the comment and producing role', () => {
    const outcome = requestRevision({
      artifactPath: 'docs/ARCHITECTURE.md',
      phaseId: 3,
      comment: 'the DB section contradicts DATABASE.md',
      requestedBy: 'brad',
    });
    expect(outcome.event).toEqual({
      eventType: 'revision.requested',
      actorId: 'brad',
      payload: {
        artifactPath: 'docs/ARCHITECTURE.md',
        phaseId: 3,
        comment: 'the DB section contradicts DATABASE.md',
        producingRole: 'architecture-designer',
      },
    });
  });

  it('routes the revision HANDOFF to the deliverable producing role, not just the phase', () => {
    // Same phase (3), different deliverable — different owning role, proving
    // routing is per-deliverable, not a single phase-wide role.
    const architecture = requestRevision({
      artifactPath: 'docs/ARCHITECTURE.md',
      phaseId: 3,
      comment: 'x',
      requestedBy: 'brad',
    });
    const threatModel = requestRevision({
      artifactPath: 'docs/THREAT_MODEL.md',
      phaseId: 3,
      comment: 'y',
      requestedBy: 'brad',
    });
    expect(architecture.handoff.role).toBe('architecture-designer');
    expect(threatModel.handoff.role).toBe('threat-modeler');
    expect(architecture.handoff.writeScope).toEqual(['docs/ARCHITECTURE.md']);
    expect(architecture.handoff.ticket.id).toContain('docs/ARCHITECTURE.md');
  });

  it('AC2: invalidates the commented phase and every downstream phase immediately', () => {
    const outcome = requestRevision({
      artifactPath: 'docs/SRS.md',
      phaseId: 2,
      comment: 'missing NFRs',
      requestedBy: 'brad',
    });
    const invalidatedIds = outcome.invalidated.map((r) => r.phaseId);
    expect(invalidatedIds).toEqual([2, 3, 4, 5]);
    expect(outcome.invalidated.every((r) => r.stale)).toBe(true);
    expect(outcome.invalidated[0]?.reasons[0]).toContain('docs/SRS.md');
    // Earlier phases (0, 1) are untouched by a phase-2 revision.
    expect(invalidatedIds).not.toContain(0);
    expect(invalidatedIds).not.toContain(1);
  });

  it('refuses feedback on a path that is not a declared deliverable of the phase', () => {
    expect(() =>
      requestRevision({
        artifactPath: 'docs/NOT_A_REAL_DOC.md',
        phaseId: 3,
        comment: 'x',
        requestedBy: 'brad',
      }),
    ).toThrow(UnknownDeliverableError);
  });

  it('every declared deliverable across all six phases resolves without throwing', () => {
    for (const phase of getPhaseFixtures()) {
      for (const deliverable of phase.deliverables) {
        expect(() =>
          requestRevision({
            artifactPath: deliverable.id,
            phaseId: phase.id,
            comment: 'ok',
            requestedBy: 'brad',
          }),
        ).not.toThrow();
      }
    }
  });
});

function getPhaseFixtures() {
  return [0, 1, 2, 3, 4, 5].map((id) => getPhase(id as 0 | 1 | 2 | 3 | 4 | 5));
}
