import { describe, expect, it } from 'vitest';
import {
  DuplicateAuditFindingError,
  IMPROVE_MODE,
  buildFixBacklog,
  findingToTicketDraft,
  prioritizeFindings,
  type AuditFinding,
} from './improve.js';

const CRITICAL: AuditFinding = {
  id: 'F-1',
  area: 'Security',
  problem: 'SQL injection in search endpoint',
  severity: 'critical',
  size: 'S',
  fixSummary: 'Parameterize the query',
  verifyWith: 'security-auditor re-check',
  writeScope: ['apps/server/src/search/**'],
};

const LOW: AuditFinding = {
  id: 'F-2',
  area: 'Code Quality',
  problem: 'Inconsistent naming in utils',
  severity: 'low',
  size: 'S',
  fixSummary: 'Rename to camelCase',
  verifyWith: 'code-reviewer re-check',
  writeScope: ['apps/server/src/utils/**'],
};

const HIGH: AuditFinding = {
  id: 'F-3',
  area: 'Performance',
  problem: 'N+1 query on dashboard load',
  severity: 'high',
  size: 'M',
  fixSummary: 'Batch the per-row lookups',
  verifyWith: 'perf-synthesizer re-check',
  writeScope: ['apps/server/src/dashboard/**'],
};

describe('IMPROVE_MODE', () => {
  it('R-B5: macro coverage-loop cap is 2', () => {
    expect(IMPROVE_MODE.macroLoopCap).toBe(2);
  });
});

describe('prioritizeFindings', () => {
  it('orders Critical -> High -> Medium -> Low', () => {
    const ordered = prioritizeFindings([LOW, CRITICAL, HIGH]);
    expect(ordered.map((f) => f.id)).toEqual(['F-1', 'F-3', 'F-2']);
  });

  it('does not mutate the input array', () => {
    const input = [LOW, CRITICAL];
    prioritizeFindings(input);
    expect(input).toEqual([LOW, CRITICAL]);
  });
});

describe('findingToTicketDraft', () => {
  it('carries fix summary as acceptance and verifyWith as the executable verify', () => {
    const draft = findingToTicketDraft(CRITICAL);
    expect(draft.acceptance).toEqual(['Parameterize the query']);
    expect(draft.verify).toBe('security-auditor re-check');
    expect(draft.writeScope).toEqual(['apps/server/src/search/**']);
  });

  it('types critical/high findings as bug, medium/low as task', () => {
    expect(findingToTicketDraft(CRITICAL).type).toBe('bug');
    expect(findingToTicketDraft(HIGH).type).toBe('bug');
    expect(findingToTicketDraft(LOW).type).toBe('task');
  });
});

describe('buildFixBacklog (FR-P5 AC1: audit + fix backlog as tickets)', () => {
  it('produces a DecomposedPlan with one ticket per finding, severity-ordered', () => {
    const plan = buildFixBacklog([LOW, CRITICAL, HIGH]);
    expect(plan.tickets.map((t) => t.id)).toEqual(['F-1', 'F-3', 'F-2']);
    expect(plan.tickets[0]?.acceptance[0]?.text).toBe('Parameterize the query');
  });

  it('derives lanes from write-scope disjointness, same engine as the design-phase decomposer', () => {
    const plan = buildFixBacklog([CRITICAL, HIGH]);
    // Disjoint write scopes -> disjoint lanes (never guessed, per decompose()'s own contract).
    expect(plan.tickets[0]?.lane).not.toBe(plan.tickets[1]?.lane);
  });

  it('renders a non-empty Mermaid DAG alongside the tickets', () => {
    const plan = buildFixBacklog([CRITICAL]);
    expect(plan.mermaid.length).toBeGreaterThan(0);
  });

  it('rejects a finding-id collision before it can corrupt the DAG', () => {
    const duplicate: AuditFinding = { ...HIGH, id: CRITICAL.id };
    expect(() => buildFixBacklog([CRITICAL, duplicate])).toThrow(
      DuplicateAuditFindingError,
    );
  });
});
