/**
 * Coverage tracker for the screenshot sweeps (`capture-tour.mjs`): a
 * declared list of states the sweep intends to capture, checked against
 * what actually got captured. Mirrors the project's own DONE/WAIVED/SKIPPED
 * vocabulary (SRS FR-L4) rather than inventing a parallel one: every
 * declared state ends in exactly one of
 *   - DONE    — captured, and its own assertion (if any) held
 *   - WAIVED  — declared up front with a reason; never expected to capture
 *               (e.g. a component that exists but isn't mounted anywhere
 *               reachable in the running app)
 * A state that is neither is SKIPPED — undeclared, silent coverage loss —
 * and `finish()` throws rather than let the sweep sign off on it (W10-37
 * AC4: "a declared state list it walks, with a failure when a state is
 * skipped"). No I/O here — pure bookkeeping so it's unit-testable without a
 * browser (`state-coverage.test.mjs`).
 */

export function createCoverageTracker(declared) {
  const ids = declared.map((d) => d.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    throw new Error(`duplicate declared state id(s): ${[...new Set(dupes)].join(', ')}`);
  }
  const byId = new Map(declared.map((d) => [d.id, d]));
  const results = new Map();

  function capture(id) {
    const decl = byId.get(id);
    if (!decl) {
      throw new Error(`captured undeclared state "${id}" — add it to the declared state list first`);
    }
    if (decl.waiver) {
      throw new Error(`state "${id}" is declared WAIVED (${decl.waiver}) — cannot also capture it`);
    }
    if (results.has(id)) {
      throw new Error(`state "${id}" captured twice`);
    }
    results.set(id, { id, status: 'done' });
  }

  /** Throws with the state id in the message so a failed assertion always names which declared state it broke. */
  function assert(id, condition, message) {
    if (!condition) {
      throw new Error(`state "${id}" failed its assertion: ${message}`);
    }
  }

  function finish() {
    const skipped = [];
    const report = declared.map((d) => {
      if (d.waiver) return { id: d.id, status: 'waived', reason: d.waiver };
      const result = results.get(d.id);
      if (!result) {
        skipped.push(d.id);
        return { id: d.id, status: 'skipped' };
      }
      return result;
    });
    if (skipped.length > 0) {
      throw new Error(
        `${skipped.length} declared state(s) never captured (SKIPPED): ${skipped.join(', ')} — the sweep cannot report full coverage`,
      );
    }
    return report;
  }

  return { capture, assert, finish };
}
