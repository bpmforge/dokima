// conductor/lint.mjs — the board preflight linter.
// Chapter of scripts/conductor.mjs, split under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only, no behaviour change.

import { testSiblingWarning, migrationCollisions, migrationScopeWarning, pageMountWarning, nonWildPrefix, globToRegex } from '../conductor-lib.mjs';
import { CONFIG, sh, git, ALWAYS_OK } from './context.mjs';

// ---------- plan linter (preflight; catches bad tickets before a run) ----------
export function lintPlan(plan) {
  const errors = [], warnings = [];
  if (CONFIG.migrationVersions?.pattern) {
    const onDisk = (CONFIG.migrationVersions.dirs || []).flatMap((d) => {
      try { return sh('git', ['ls-files', d]).split('\n').map((f) => new RegExp(CONFIG.migrationVersions.pattern).exec(f)).filter(Boolean).map((m) => m[1]); }
      catch { return []; }
    });
    warnings.push(...migrationCollisions(plan.tickets, CONFIG.migrationVersions, onDisk));
  }
  const ids = new Set(plan.tickets.map((t) => t.id));
  // Pages already on disk: a ticket EDITING one needs no route or nav entry.
  const existingPages = (() => {
    const pat = CONFIG.pageMount?.page;
    if (!pat) return [];
    try {
      return git('ls-files').split('\n').filter((f) => new RegExp(pat).test(f));
    } catch { return []; }
  })();
  for (const t of plan.tickets) {
    for (const k of ['id', 'title', 'lane', 'write_scope', 'depends_on', 'acceptance', 'status']) {
      if (t[k] === undefined) errors.push(`${t.id || '?'}: missing '${k}'`);
    }
    if (t.write_scope && !t.write_scope.length) errors.push(`${t.id}: empty write_scope`);
    { const w = testSiblingWarning(t, CONFIG.testSibling); if (w) warnings.push(w); }
    { const w = pageMountWarning(t, CONFIG.pageMount, existingPages); if (w) warnings.push(w); }
    { const w = migrationScopeWarning(t, CONFIG.migrationScope); if (w) warnings.push(w); }
    if (t.acceptance && !t.acceptance.length) errors.push(`${t.id}: empty acceptance`);
    for (const d of t.depends_on || []) if (!ids.has(d)) errors.push(`${t.id}: depends_on unknown ticket '${d}'`);

    // High-value heuristic: acceptance names a source path that no write_scope glob
    // (nor the shared-infra allowlist) can cover — the exact defect that blocked
    // W0-01 (pnpm-lock) and W0-05 (migrations dir excluded from its own scope).
    const scopeRe = (t.write_scope || []).map(globToRegex);
    const scopePfx = (t.write_scope || []).map(nonWildPrefix);
    const scopeTop = new Set((t.write_scope || []).map((g) => g.split('/')[0]));
    const text = (t.acceptance || []).join(' ');
    const paths = [...text.matchAll(/([\w.-]+(?:\/[\w.*-]+)+\.[a-z]{2,4})/g)].map((m) => m[1]);
    for (const p of [...new Set(paths)]) {
      if (p.startsWith('docs/') || p.startsWith('.')) continue; // docs + dotpaths are shared/runtime, not deliverables
      // Only flag a path that lives in the ticket's OWN top-level territory but that
      // its globs can't cover — the "gap in my own scope" pattern (W0-05 class),
      // not an incidental path mention from elsewhere in the tree.
      if (!scopeTop.has(p.split('/')[0])) continue;
      const covered = scopeRe.some((r) => r.test(p)) || ALWAYS_OK.some((r) => r.test(p)) || scopePfx.some((pfx) => pfx && p.startsWith(pfx));
      if (!covered) warnings.push(`${t.id}: acceptance names '${p}' in its own area but no write_scope glob covers it`);
    }
  }
  // dependency cycle detection
  const deps = new Map(plan.tickets.map((t) => [t.id, t.depends_on || []]));
  const state = new Map();
  const visit = (n, stack) => {
    if (stack.has(n)) { errors.push(`dependency cycle: ${[...stack, n].join(' -> ')}`); return; }
    if (state.get(n)) return;
    state.set(n, true);
    for (const d of deps.get(n) || []) if (ids.has(d)) visit(d, new Set([...stack, n]));
  };
  for (const id of ids) visit(id, new Set());
  return { errors, warnings };
}

