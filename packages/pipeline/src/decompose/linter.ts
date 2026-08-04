import { globOverlaps } from './lanes.js';
import type { InterfaceRef, LintViolation, TicketDraftInput } from './types.js';

function interfaceKey(ref: InterfaceRef): string {
  return `${ref.packageName}#${ref.exportName}`;
}

/**
 * Seam lesson #1 (field report §10, the W0-08 class): a ticket whose
 * deliverable imports a workspace sibling can only declare that dependency
 * if its own write_scope covers its own package's `package.json` — W0-08
 * needed `@dokima/{events,tickets,shared}` in `apps/server/package.json`
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
/**
 * Seam lesson #4 (W10-76, measured on a real board): a `writeScope` entry that
 * is not a path at all.
 *
 * Two boards were built minutes apart by the same model from the same prompt.
 * One carried real globs (`["src/db/schema.ts","src/types/models.ts"]`); the
 * other carried the ACCEPTANCE CRITERIA in prose — `["Initialize Supabase
 * project on free tier", "Define SQL schema for 'lists' and 'items'"]` — on
 * 8 of 8 tickets, while the verify command sat in `acceptance`. Nothing
 * objected, because every existing check here is about SEAMS between tickets
 * and none of them asks whether a scope is path-SHAPED.
 *
 * WHY IT MATTERS, precisely: `globToRegExp` only treats `*` and `?` specially,
 * so a sentence compiles to `^…the whole sentence…$` and matches no path. The
 * loop's `detectScopeViolations` returns every changed path matching NO glob,
 * so an agent working such a ticket has EVERY file it touches flagged
 * out-of-scope and the close gate refuses. Fail-closed, not fail-open: the
 * ticket is unworkable rather than unguarded, and it fails after the model
 * spend, not before it.
 *
 * IT IS ALSO WHY THE OTHER CHECKS GO QUIET. `findMissingPackageJsonScope`
 * fires only when `globOverlaps` fails to match a package.json, and prose
 * matches nothing — so the prose board reported ZERO violations and the
 * correct board reported five. Wrong input produced a cleaner report.
 *
 * A VIOLATION, NOT A REFUSAL, deliberately: `decompose` already surfaces
 * violations with the DAG, and throwing away a whole multi-call pipeline over
 * a malformed field is the mistake W10-65 exists to remember. The founder is
 * told, the board still exists, and the ticket names what to fix.
 */
export function findUnpathlikeWriteScope(
  tickets: readonly TicketDraftInput[],
): LintViolation[] {
  const violations: LintViolation[] = [];
  for (const ticket of tickets) {
    for (const pattern of ticket.writeScope) {
      const reason = unpathlikeReason(pattern);
      if (!reason) continue;
      violations.push({
        kind: 'unpathlike-write-scope',
        ticketId: ticket.id,
        detail:
          `write_scope entry ${JSON.stringify(pattern)} is not a path or glob (${reason}) — ` +
          `it matches no file, so every change an agent makes would be refused as out of scope`,
      });
    }
  }
  return violations;
}

/** `undefined` when the entry is plausibly a path; otherwise why it is not. */
function unpathlikeReason(pattern: string): string | undefined {
  if (pattern.trim().length === 0) return 'empty';
  // Whitespace is the unambiguous tell. Every entry on the board this defect
  // produced was a sentence; no write_scope this repo has ever used contains a
  // space. Checked before the weaker heuristic below so the message is precise.
  if (/\s/.test(pattern)) return 'contains whitespace — this reads as prose';
  // A bare word with no separator, glob or extension can only ever match a
  // single file of exactly that name, which is never what a scope means.
  if (!/[/*.]/.test(pattern)) {
    return 'has no path separator, glob or extension';
  }
  return undefined;
}

export function lintDecomposition(tickets: readonly TicketDraftInput[]): LintViolation[] {
  return [
    ...findMissingPackageJsonScope(tickets),
    ...findUnownedInterfaces(tickets),
    ...findDependencyCycles(tickets),
    ...findUnpathlikeWriteScope(tickets),
  ];
}
