import { globOverlaps } from './lanes.js';
import type { InterfaceRef, LintViolation, TicketDraftInput } from './types.js';

function interfaceKey(ref: InterfaceRef): string {
  return `${ref.packageName}#${ref.exportName}`;
}

/**
 * Seam lesson #1 (field report §10, the W0-08 class): a ticket whose
 * deliverable imports a workspace sibling can only declare that dependency
 * if its own write_scope covers its own package's `package.json` — W0-08
 * needed `@shipwright/{events,tickets,shared}` in `apps/server/package.json`
 * but its write_scope was only `apps/server/src/cli/**` and could not add
 * its own dependency. Doc-only tickets (`ownPackage === null`) are exempt.
 */
export function findMissingPackageJsonScope(
  tickets: readonly TicketDraftInput[],
): LintViolation[] {
  const violations: LintViolation[] = [];
  for (const ticket of tickets) {
    if (!ticket.ownPackage || ticket.importsWorkspacePackages.length === 0) continue;
    const requiredPath = `${ticket.ownPackage}/package.json`;
    const covered = ticket.writeScope.some((pattern) =>
      globOverlaps(pattern, requiredPath),
    );
    if (covered) continue;
    for (const pkg of ticket.importsWorkspacePackages) {
      violations.push({
        kind: 'missing-package-json-scope',
        ticketId: ticket.id,
        detail: `imports ${pkg} but write_scope omits ${requiredPath} — cannot declare the dependency`,
      });
    }
  }
  return violations;
}

/**
 * Seam lesson #2 (field report §10, the W1-02 class): W0-05 built
 * `mintReceipt`, W1-02 consumed it, but neither ticket owned re-exporting it
 * from the package's public `index.ts` — the function existed and was
 * invisible. Every interface a ticket consumes must have SOME ticket in the
 * DAG that declares itself the owner of its public re-export.
 */
export function findUnownedInterfaces(
  tickets: readonly TicketDraftInput[],
): LintViolation[] {
  const provided = new Set<string>();
  for (const ticket of tickets) {
    for (const ref of ticket.providesInterfaces) provided.add(interfaceKey(ref));
  }

  const violations: LintViolation[] = [];
  for (const ticket of tickets) {
    for (const ref of ticket.consumesInterfaces) {
      if (provided.has(interfaceKey(ref))) continue;
      violations.push({
        kind: 'unowned-interface',
        ticketId: ticket.id,
        detail: `consumes ${interfaceKey(ref)} but no ticket in the DAG owns its public re-export`,
      });
    }
  }
  return violations;
}

/**
 * AC1 calls the output a "typed ticket DAG" — a graph with a cycle isn't
 * one (nothing in a cyclic depends_on set is ever claimable). Only edges
 * whose target is IN this batch are followed: a depends_on referencing a
 * ticket outside the batch (an already-landed ticket from an earlier wave,
 * same shape as plan.json's own W5-07 -> W5-01/W0-04) is a legitimate
 * boundary edge, not evidence of a cycle this decomposition can see.
 */
export function findDependencyCycles(
  tickets: readonly TicketDraftInput[],
): LintViolation[] {
  const ids = new Set(tickets.map((t) => t.id));
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const state = new Map<string, 'visiting' | 'done'>();
  const seenCycles = new Set<string>();
  const violations: LintViolation[] = [];

  function visit(id: string, stack: readonly string[]): void {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const cycleStart = stack.indexOf(id);
      const cycle = [...stack.slice(cycleStart), id];
      const key = [...cycle].sort().join('>');
      if (!seenCycles.has(key)) {
        seenCycles.add(key);
        violations.push({
          kind: 'dependency-cycle',
          ticketId: cycle[0] ?? id,
          detail: `dependency cycle: ${cycle.join(' -> ')}`,
        });
      }
      return;
    }
    state.set(id, 'visiting');
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (ids.has(dep)) visit(dep, [...stack, id]);
    }
    state.set(id, 'done');
  }

  for (const id of [...ids].sort()) visit(id, []);
  return violations;
}

/** The two seam-lesson plan-linter checks (AC2) plus the DAG-acyclicity
 * check (AC1), run together and emitted with the DAG rather than thrown. */
export function lintDecomposition(tickets: readonly TicketDraftInput[]): LintViolation[] {
  return [
    ...findMissingPackageJsonScope(tickets),
    ...findUnownedInterfaces(tickets),
    ...findDependencyCycles(tickets),
  ];
}
