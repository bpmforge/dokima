/**
 * W21-97. Describing a houseplant tracker through the UI produced nine
 * tickets, every one a feature — including VAPID key provisioning and an
 * authenticated cron endpoint, with nothing reviewing either. The person that
 * plan was written for may have no development experience and would never
 * think to ask for a security review.
 */
import { describe, expect, it } from 'vitest';
import { decompose } from './decompose.js';
import { qualityTicketsFor } from './quality-tickets.js';
import type { TicketDraftInput } from './types.js';

function draft(over: Partial<TicketDraftInput> = {}): TicketDraftInput {
  return {
    id: 'T1',
    type: 'task',
    title: 'Build the thing',
    writeScope: ['src/thing.ts'],
    dependsOn: [],
    acceptance: ['it works'],
    verify: 'npm test',
    ownPackage: null,
    importsWorkspacePackages: [],
    providesInterfaces: [],
    consumesInterfaces: [],
    ...over,
  };
}

describe('every generated plan carries its quality work (W21-97)', () => {
  it('RED FIXTURE: a feature-only plan gains security, accessibility, code health, performance, tests and release readiness', () => {
    const plan = decompose([draft()], { includeQualityWork: true });
    const ids = plan.tickets.map((t) => t.id);
    for (const suffix of [
      'SECURITY-REVIEW',
      'ACCESSIBILITY',
      'CODE-HEALTH',
      'PERFORMANCE',
      'TEST-COVERAGE',
      'RELEASE-READINESS',
    ]) {
      expect(ids, suffix).toContain(`QUALITY-${suffix}`);
    }
  });

  it('they depend on the feature work, so none can be closed first', () => {
    const plan = decompose([draft({ id: 'A' }), draft({ id: 'B', writeScope: ['src/b.ts'] })], { includeQualityWork: true });
    for (const t of plan.tickets.filter((x) => x.id.startsWith('QUALITY-'))) {
      expect(t.dependsOn, t.id).toEqual(expect.arrayContaining(['A', 'B']));
    }
  });

  it('does not duplicate work the model already thought of', () => {
    const withSecurity = draft({
      id: 'S1',
      title: 'Security review of the auth flow',
      writeScope: ['src/auth.ts'],
    });
    const ids = decompose([withSecurity], { includeQualityWork: true }).tickets.map((t) => t.id);
    expect(ids).not.toContain('QUALITY-SECURITY-REVIEW');
    // …but the others it did not think of are still added.
    expect(ids).toContain('QUALITY-ACCESSIBILITY');
  });

  it('adds nothing to an empty plan — there is no work to check', () => {
    expect(qualityTicketsFor([])).toEqual([]);
  });

  it('introduces no plan-linter violations of its own', () => {
    expect(decompose([draft()], { includeQualityWork: true }).violations).toEqual([]);
  });

  it('each carries acceptance a person can actually check, in plain language', () => {
    for (const t of qualityTicketsFor([draft()])) {
      expect(t.acceptance.length, t.id).toBeGreaterThan(0);
      for (const criterion of t.acceptance) {
        expect(criterion.length, `${t.id}: "${criterion}"`).toBeGreaterThan(20);
        // Internal vocabulary is for wire shapes, not for the person reading
        // the board (VOCABULARY.md).
        expect(criterion).not.toMatch(/write_scope|dependsOn|DAG|glob/);
      }
    }
  });

  it('their scopes never overlap the feature work — that would be a lane collision', () => {
    const features = [draft({ id: 'A', writeScope: ['src/**'] })];
    for (const q of qualityTicketsFor(features)) {
      for (const pattern of q.writeScope) {
        expect(pattern.startsWith('docs/quality/'), `${q.id}: ${pattern}`).toBe(true);
      }
    }
  });
});
