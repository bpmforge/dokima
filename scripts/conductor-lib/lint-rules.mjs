// conductor-lib/lint-rules.mjs — chapter of the conductor's pure helper library.
// Split out of the 590-line scripts/conductor-lib.mjs under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only: same exported names, same
// behaviour. scripts/conductor-lib.mjs remains the barrel every caller imports,
// so no call site moved.


export function testSiblingWarning(ticket, cfg) {
  if (!cfg || !cfg.source || !cfg.test) return null;
  // A done ticket's scope is settled; warning about it every lint run is noise
  // that buries the actionable ones. On Kryptkeeper's board this was 27 of 29
  // warnings. Same guard pageMountWarning already carries.
  if (ticket?.status === 'done') return null;
  const sourceRe = new RegExp(cfg.source);
  const testRe = new RegExp(cfg.test);
  const scope = ticket.write_scope || [];
  const impl = scope.filter((f) => sourceRe.test(f) && !testRe.test(f));
  if (!impl.length) return null;

  // Per-implementation-file, NOT "is there any test file at all". The earlier
  // form returned null as soon as ONE scoped path matched the test regex, so a
  // ticket scoping two implementation files plus one unrelated integration test
  // passed clean while neither impl file could get a sibling. Kryptkeeper S-05
  // hit exactly that: cmd/kryptkeeper-agent/installers/{iis,haproxy}.go with
  // tests/integration/apache_e2e_test.go in scope — different directory,
  // different subject, rule silent.
  //
  // A test counts for an impl file when it sits in the same directory. That is
  // deliberately looser than exact-sibling naming (foo.go -> foo_test.go),
  // because Go allows foo_internal_test.go and table tests grouped per package,
  // and a rule that demands one exact filename would produce false warnings on
  // legitimate layouts — the failure mode that got pageMountWarning narrowed.
  const dirOf = (f) => f.slice(0, f.lastIndexOf('/') + 1);
  const testDirs = new Set(scope.filter((f) => testRe.test(f)).map(dirOf));
  const uncovered = impl.filter((f) => !testDirs.has(dirOf(f)));
  if (!uncovered.length) return null;
  return `${ticket.id}: write_scope has implementation (${uncovered.join(', ')}) but no test sibling in the same directory matching ${cfg.test} — the agent cannot add tests for it without an out-of-scope gate failure`;
}


/**
 * Lint rule: a ticket whose acceptance text demands a schema change must
 * scope a path into the project's migrations directory, or the maker
 * session self-blocks partway through — the exact defect W10-68 hit twice
 * (2026-08-04, then again 2026-08-05 after the first widening), for a
 * combined ~17 minutes of maker session plus two human decisions, on a gap
 * that is visible in the ticket text without running anything. W11-08.
 *
 * Deliberately NOT solved by teaching MASTER_PROMPT.md about
 * conductor.config.json's `alwaysOk` list, even though `alwaysOk` already
 * lists `packages/events/migrations/**` and so looks like permission the
 * maker already has. `alwaysOk` is a GATE-SIDE amnesty
 * (scripts/conductor/gates.mjs) consumed only when checking a landed diff
 * against write_scope — the maker session never sees it. MASTER_PROMPT.md
 * step 3 tells the maker to implement inside write_scope and report rather
 * than widen it, and both of W10-68's self-blocks were the CORRECT response
 * to that instruction: the same sentence that would have unblocked it
 * licenses silent scope drift on every other ticket that touches a schema
 * without meaning to. The fix belongs at filing time, not in the maker's
 * instructions.
 */
export function migrationScopeWarning(ticket, cfg) {
  if (!cfg || !cfg.trigger || !cfg.dir) return null;
  // Same guard as testSiblingWarning/pageMountWarning: a done ticket's scope
  // is settled, so warning about it is noise that buries the actionable ones.
  if (ticket?.status === 'done') return null;
  const text = (ticket.acceptance || []).join(' ');
  if (!new RegExp(cfg.trigger, 'i').test(text)) return null;
  const dirRe = new RegExp(cfg.dir);
  const scope = ticket.write_scope || [];
  if (scope.some((f) => dirRe.test(f))) return null;
  return `${ticket.id}: acceptance requires a schema change but write_scope has no glob under ${cfg.dir} — the agent will self-block partway through (W10-68 did, twice)`;
}

/**
 * Lint rule: versioned-migration collisions.
 *
 * A migration runner that keys files by numeric prefix (Kryptkeeper's
 * loadMigrations uses map[int]*migrationFile over a filename-sorted embed.FS)
 * will silently let one version's SQL overwrite another's, while the schema
 * table records whichever name sorts first. Idempotent schema creation means
 * the test suite may stay green over a corrupted schema. Versions themselves
 * are gap-tolerant (loadMigrations applies in sorted numeric order
 * regardless of gaps) — see CLAUDE.md "Migration version numbers" — so this
 * rule only cares whether a version number resolves to more than one
 * distinct migration file, never whether the numbering is contiguous.
 *
 * Kryptkeeper 2026-07-29 had two live collisions at once: 000030 claimed by
 * two tickets, and 000027 claimed by a todo ticket that was already on disk.
 * A third would have happened had an agent's invented number stuck. That
 * same day, S-27 fixed a false positive on 000027: W9-04 and S-20 both
 * legitimately claim 000027_ca_key_rotations — the SAME file, deliberately
 * shared — which is not two tickets writing one version. Collision detection
 * therefore compares the distinct migration FILENAMES claimed under a
 * version, not just the count of claiming tickets.
 *
 * `onDisk` is the set of versions that already exist. A version with no open
 * (non-`done`) owner is skipped entirely — nothing left to warn about. Once
 * there is an open owner, sharing the same filename with a `done` owner
 * still surfaces the "already exists on disk" warning: it is a
 * schema-corruption-relevant check, so a noisy prompt for a human to confirm
 * the sharing is deliberate beats staying silent on a case this function
 * cannot fully distinguish from an open ticket about to overwrite a shipped
 * migration.
 */
export function migrationCollisions(tickets, cfg, onDisk = []) {
  if (!cfg || !cfg.pattern) return [];
  const re = new RegExp(cfg.pattern);
  const shipped = new Set(onDisk);
  const claims = new Map(); // version -> Map<ticket, Set<migration base filename>>
  for (const t of tickets) {
    for (const f of t.write_scope || []) {
      const m = re.exec(f);
      if (!m) continue;
      const version = m[1];
      const base = f.slice(f.lastIndexOf('/') + 1).replace(/\.(up|down)\.sql$/, '');
      if (!claims.has(version)) claims.set(version, new Map());
      const byTicket = claims.get(version);
      if (!byTicket.has(t)) byTicket.set(t, new Set());
      byTicket.get(t).add(base);
    }
  }
  const out = [];
  for (const [version, byTicket] of [...claims].sort()) {
    const owners = [...byTicket.keys()];
    const open = owners.filter((t) => t.status !== 'done');
    if (!open.length) continue;
    const distinctFiles = new Set([...byTicket.values()].flatMap((s) => [...s]));
    if (distinctFiles.size > 1) {
      out.push(`migration ${version} is claimed by ${owners.map((t) => `${t.id}(${t.status})`).join(', ')} — two tickets writing one version silently overwrite each other`);
    } else if (shipped.has(version)) {
      out.push(`migration ${version} is claimed by ${open[0].id}(${open[0].status}) but already exists on disk — it would overwrite a shipped migration`);
    }
  }
  return out;
}

/**
 * W3-15 portability: compare the running Node against a project's version pin.
 *
 * Returns null when the pin is satisfied (or is empty/unreadable), else a
 * message. The FILE is read by the caller — this stays pure so it is testable
 * without a fixture tree, and so a project with no pin at all is simply not
 * checked rather than refused. See CONFIG.nvmrcPath.
 */

export function doneCheckGap(status, boardPath = 'plan.json') {
  return `${boardPath} status is '${status}', expected 'done'`;
}

/**
 * The per-ticket coding-session prompt. Pure string templating (no I/O), so —
 * per the file header — it lives here rather than in conductor.mjs so it's
 * directly unit-testable. Every mention of where the board lives names
 * `boardPath` (default 'plan.json'): telling the agent the wrong location is
 * a silent failure (the agent looks fine, then edits a board that isn't the
 * one the conductor gates against).
 */

export function pageMountWarning(ticket, cfg, existingPages = []) {
  if (!cfg || !cfg.page || !Array.isArray(cfg.mounts)) return null;
  // A done ticket's mounting is already settled one way or the other; warning
  // about it is pure noise on every lint run.
  if (ticket?.status === 'done') return null;
  const scope = ticket?.write_scope ?? [];
  const pageRe = new RegExp(cfg.page);
  // Only a NEW page needs mounting. A ticket editing an existing page needs no
  // route and no nav entry, and warning about those is the false-positive that
  // makes a linter get ignored — the same trap migrationCollisions fell into by
  // comparing version numbers instead of filenames.
  const existing = new Set(existingPages);
  const newPages = scope.filter((p) => pageRe.test(p) && !existing.has(p));
  if (!newPages.length) return null;

  const missing = cfg.mounts.filter((m) => !scope.includes(m));

  if (cfg.writes && Array.isArray(cfg.writeMounts)) {
    const text = [...(ticket.acceptance ?? []), ticket.title ?? ''].join(' ');
    if (new RegExp(cfg.writes, 'i').test(text)) {
      for (const m of cfg.writeMounts) if (!scope.includes(m)) missing.push(m);
    }
  }

  if (!missing.length) return null;
  return `${ticket.id}: write_scope adds a UI page but omits ${[...new Set(missing)].join(', ')} — the page would compile and be unreachable`;
}

/**
 * Gap text for a board that could not be read at all.
 *
 * Distinct from doneCheckGap on purpose. An unreadable board and a board saying
 * the wrong status are different failures with different fixes — the first
 * means the worktree is gone or the file was never written, the second means
 * the agent did not close the ticket. Collapsing them into one message sends
 * whoever reads the log looking at the agent when the worktree is the problem.
 *
 * Kryptkeeper 2026-07-30: an unguarded loadPlan(wt) on a worktree that no
 * longer existed threw ENOENT out of runGates and killed the entire run three
 * times. supervise.sh recovered each time (~35s), but a missing worktree should
 * fail its TICKET, not the run — every other ticket in the queue is unaffected
 * by one worktree going missing.
 */
export function boardUnreadableGap(boardPath, err) {
  const reason = String(err?.code || err?.message || err || 'unknown error');
  return `${boardPath} could not be read in the ticket worktree (${reason}) — treating as a ticket failure, not a run failure`;
}
