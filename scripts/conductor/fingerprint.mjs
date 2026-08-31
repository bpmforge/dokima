// conductor/fingerprint.mjs — structured failure fingerprints and the
// base-vs-candidate differential classifier (P2-02, incident review Stages
// 1-2). Deterministic tooling makes the causal call; a model may EXPLAIN the
// result, its prose can never override the classification.
//
// The founding incident: a runtime expert judged a failure "pre-existing"
// while the close gate saw the same nonzero exit — two correct answers to two
// different questions, with no state for "candidate valid, base red." This
// module is that state machine's evidence layer.

import { createHash } from 'node:crypto';

// ESC built via charCode so the pattern carries no literal control character
// (eslint no-control-regex) — same bytes, lintable source.
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/**
 * Strip everything volatile before comparison. A fingerprint that embeds a
 * timestamp, port, tmp path, or duration never matches its twin from the
 * other worktree, and the differential silently degrades to "everything is
 * new" — charging the candidate for the base's debt.
 */
export function normalizeLine(line) {
  return String(line)
    .replace(ANSI_RE, '') // ANSI
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>')
    .replace(/\b\d+(\.\d+)?\s*(ms|s|sec|seconds)\b/g, '<dur>')
    .replace(/(?:localhost|127\.0\.0\.1):\d{2,5}/g, '<host:port>')
    .replace(/(?:\/private)?\/(?:var\/folders|tmp)\/\S+/g, '<tmp>')
    .replace(/\b[0-9a-f]{12,40}\b/g, '<hex>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse verify output into failure rows. Understands vitest's FAIL lines and
 * assertion blocks; anything unparseable degrades to ONE command-level row so
 * a failure is never dropped just because its format is unknown — an unknown
 * failure that vanishes from the diff would be classified as "fixed".
 *
 * Row: {suite, test, file, line, errorClass}
 */
export function parseFailures(commandName, text) {
  const rows = [];
  const clean = String(text).replace(ANSI_RE, '');
  // vitest: "FAIL  path > suite > test" or " × test name" under a FAIL file
  const failLine = /^\s*(?:FAIL|×|✗|✘)\s+(.+)$/gm;
  let m;
  while ((m = failLine.exec(clean)) !== null) {
    const parts = m[1].split('>').map((p) => p.trim());
    rows.push({
      suite: parts.length > 1 ? parts[0] : commandName,
      test: parts.length > 1 ? parts.slice(1).join(' > ') : parts[0],
      file: (parts[0].match(/[\w./-]+\.[cm]?[jt]sx?/) ?? [null])[0],
      line: null,
      errorClass: 'test-failure',
    });
  }
  // assertion classes: "AssertionError:", "TypeError:", "Error: ..."
  const errLine = /^\s*([A-Z][\w]*Error):\s+(.+)$/gm;
  while ((m = errLine.exec(clean)) !== null) {
    rows.push({
      suite: commandName,
      test: normalizeLine(m[2]).slice(0, 160),
      file: null,
      line: null,
      errorClass: m[1],
    });
  }
  if (rows.length === 0) {
    rows.push({
      suite: commandName,
      test: null,
      file: null,
      line: null,
      errorClass: 'nonzero-exit',
    });
  }
  return rows;
}

/** Stable identity for one failure row (order-independent set semantics). */
export function fingerprint(row) {
  const preimage = ['suite', 'test', 'file', 'errorClass']
    .map((k) => `${k}=${normalizeLine(row[k] ?? '')}`)
    .join('|');
  return createHash('sha256').update(preimage).digest('hex').slice(0, 16);
}

/** Parse a receipt's failed commands into fingerprinted rows. */
export function receiptFingerprints(receipt) {
  const rows = [];
  for (const c of receipt?.commands ?? []) {
    if (c.exitCode === 0) continue;
    for (const r of parseFailures(c.command, c.tailOfOutput ?? '')) {
      rows.push({ ...r, fp: fingerprint(r) });
    }
  }
  return rows;
}

/**
 * The Stage-2 differential — the four-row table from the incident review,
 * as code. Only NEW candidate failures may ever consume a coding attempt.
 *
 * @returns {{classification: string, newRows: [], sharedRows: [], baseOnlyRows: [], chargeAttempt: boolean}}
 */
export function classifyDifferential(baseRows, candRows) {
  const baseSet = new Set(baseRows.map((r) => r.fp));
  const candSet = new Set(candRows.map((r) => r.fp));
  const newRows = candRows.filter((r) => !baseSet.has(r.fp));
  const sharedRows = candRows.filter((r) => baseSet.has(r.fp));
  const baseOnlyRows = baseRows.filter((r) => !candSet.has(r.fp));

  let classification;
  if (baseRows.length === 0 && candRows.length === 0) classification = 'green';
  else if (baseRows.length === 0) classification = 'candidate_regression';
  else if (candRows.length === 0)
    classification = 'candidate_repairs_baseline'; // explicit review, never silent absorb
  else if (newRows.length === 0) classification = 'blocked_on_baseline';
  else classification = 'mixed'; // charge ONLY the new rows

  return {
    classification,
    newRows,
    sharedRows,
    baseOnlyRows,
    chargeAttempt:
      classification === 'candidate_regression' || classification === 'mixed',
  };
}
