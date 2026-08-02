import { describe, expect, it } from 'vitest';
import {
  findDependencyCycles,
  findMissingPackageJsonScope,
  findUnownedInterfaces,
  lintDecomposition,
} from './linter.js';
import type { TicketDraftInput } from './types.js';

function draft(overrides: Partial<TicketDraftInput> & { id: string }): TicketDraftInput {
  return {
    type: 'task',
    title: overrides.id,
    writeScope: [],
    dependsOn: [],
    acceptance: [],
    verify: 'true',
    ownPackage: null,
    importsWorkspacePackages: [],
    providesInterfaces: [],
    consumesInterfaces: [],
    ...overrides,
  };
}

describe('findMissingPackageJsonScope (seam lesson #1, the W0-08 class)', () => {
  it('RED FIXTURE: reproduces W0-08 — CLI ticket imports workspace siblings but its write_scope is only src/cli/**', () => {
    const ticket = draft({
      id: 'W0-08',
      ownPackage: 'apps/server',
      importsWorkspacePackages: [
        '@dokima/events',
        '@dokima/tickets',
        '@dokima/shared',
      ],
      writeScope: ['apps/server/src/cli/**'],
    });
    const violations = findMissingPackageJsonScope([ticket]);
    expect(violations.map((v) => v.kind)).toEqual([
      'missing-package-json-scope',
      'missing-package-json-scope',
      'missing-package-json-scope',
    ]);
    expect(violations.every((v) => v.ticketId === 'W0-08')).toBe(true);
  });

  it('passes once write_scope covers the ticket own package.json', () => {
    const ticket = draft({
      id: 'W0-08',
      ownPackage: 'apps/server',
      importsWorkspacePackages: ['@dokima/events'],
      writeScope: ['apps/server/src/cli/**', 'apps/server/package.json'],
    });
    expect(findMissingPackageJsonScope([ticket])).toEqual([]);
  });

  it('a `**` write_scope over the whole package covers its package.json too', () => {
    const ticket = draft({
      id: 'T',
      ownPackage: 'apps/server',
      importsWorkspacePackages: ['@dokima/events'],
      writeScope: ['apps/server/**'],
    });
    expect(findMissingPackageJsonScope([ticket])).toEqual([]);
  });

  it('doc-only tickets (ownPackage null) are exempt even with declared imports', () => {
    const ticket = draft({
      id: 'DOC',
      ownPackage: null,
      importsWorkspacePackages: ['@dokima/events'],
      writeScope: ['docs/DESIGN.md'],
    });
    expect(findMissingPackageJsonScope([ticket])).toEqual([]);
  });

  it('a ticket with no workspace imports is exempt regardless of write_scope', () => {
    const ticket = draft({
      id: 'T',
      ownPackage: 'apps/server',
      importsWorkspacePackages: [],
      writeScope: ['apps/server/src/cli/**'],
    });
    expect(findMissingPackageJsonScope([ticket])).toEqual([]);
  });
});

describe('findUnownedInterfaces (seam lesson #2, the W1-02 class)', () => {
  it('RED FIXTURE: reproduces W1-02 — mintReceipt exists but no ticket owns its public re-export', () => {
    const producer = draft({ id: 'W0-05', providesInterfaces: [] });
    const consumer = draft({
      id: 'W1-02',
      consumesInterfaces: [
        { packageName: '@dokima/events', exportName: 'mintReceipt' },
      ],
    });
    const violations = findUnownedInterfaces([producer, consumer]);
    expect(violations).toEqual([
      {
        kind: 'unowned-interface',
        ticketId: 'W1-02',
        detail:
          'consumes @dokima/events#mintReceipt but no ticket in the DAG owns its public re-export',
      },
    ]);
  });

  it('passes once some ticket declares ownership of the re-export', () => {
    const producer = draft({
      id: 'W0-05',
      providesInterfaces: [
        { packageName: '@dokima/events', exportName: 'mintReceipt' },
      ],
    });
    const consumer = draft({
      id: 'W1-02',
      consumesInterfaces: [
        { packageName: '@dokima/events', exportName: 'mintReceipt' },
      ],
    });
    expect(findUnownedInterfaces([producer, consumer])).toEqual([]);
  });

  it('a ticket may own the re-export of an interface it also consumes itself', () => {
    const ticket = draft({
      id: 'T',
      providesInterfaces: [
        { packageName: '@dokima/events', exportName: 'mintReceipt' },
      ],
      consumesInterfaces: [
        { packageName: '@dokima/events', exportName: 'mintReceipt' },
      ],
    });
    expect(findUnownedInterfaces([ticket])).toEqual([]);
  });
});

describe('findDependencyCycles (AC1: a DAG with a cycle is not a DAG)', () => {
  it('RED FIXTURE: a direct 2-cycle is caught', () => {
    const a = draft({ id: 'A', dependsOn: ['B'] });
    const b = draft({ id: 'B', dependsOn: ['A'] });
    const violations = findDependencyCycles([a, b]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toEqual('dependency-cycle');
  });

  it('catches an indirect 3-cycle', () => {
    const a = draft({ id: 'A', dependsOn: ['B'] });
    const b = draft({ id: 'B', dependsOn: ['C'] });
    const c = draft({ id: 'C', dependsOn: ['A'] });
    const violations = findDependencyCycles([a, b, c]);
    expect(violations).toHaveLength(1);
  });

  it('a depends_on referencing a ticket outside this batch is a legitimate boundary edge, not a cycle', () => {
    const a = draft({ id: 'W5-07', dependsOn: ['W5-01', 'W0-04'] });
    expect(findDependencyCycles([a])).toEqual([]);
  });

  it('a plain chain (no cycle) produces zero violations', () => {
    const a = draft({ id: 'A' });
    const b = draft({ id: 'B', dependsOn: ['A'] });
    const c = draft({ id: 'C', dependsOn: ['B'] });
    expect(findDependencyCycles([a, b, c])).toEqual([]);
  });
});

describe('lintDecomposition', () => {
  it('runs all checks and concatenates their violations', () => {
    const ticket = draft({
      id: 'T',
      ownPackage: 'apps/server',
      importsWorkspacePackages: ['@dokima/events'],
      writeScope: ['apps/server/src/cli/**'],
      consumesInterfaces: [
        { packageName: '@dokima/events', exportName: 'mintReceipt' },
      ],
      dependsOn: ['T'],
    });
    const violations = lintDecomposition([ticket]);
    expect(violations.map((v) => v.kind).sort()).toEqual([
      'dependency-cycle',
      'missing-package-json-scope',
      'unowned-interface',
    ]);
  });

  it('a clean DAG produces zero violations', () => {
    expect(lintDecomposition([draft({ id: 'T' })])).toEqual([]);
  });
});
