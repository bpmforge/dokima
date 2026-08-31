// conductor/evidence.mjs — full-fidelity failure evidence (P0-03).
//
// The W0-W11 log's gates.fail rows were byte-sliced mid-stream, leaving the
// operator fragments like "pnpm test failed: eout"." — the terminal-cause
// truncation defect the incident review names. The rule now: bounded surfaces
// (log rows, board notes) carry heads and a POINTER; the full text always
// survives on disk. Evidence is self-gitignored (M-08: evidence never dirties
// the target repository).

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { ROOT } from './context.mjs';

const EVIDENCE_BASE = resolve(ROOT, 'docs/work/attempt-evidence');

/**
 * Persist one failure artifact, untruncated. Returns the ROOT-relative path
 * for embedding in log rows and board notes.
 */
export function saveEvidence(ticketId, name, content) {
  const dir = resolve(EVIDENCE_BASE, ticketId);
  mkdirSync(dir, { recursive: true });
  const gi = resolve(EVIDENCE_BASE, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, '*\n!.gitignore\n');
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const file = resolve(dir, `${stamp}-${name.replace(/[^\w.-]+/g, '_').slice(0, 60)}.txt`);
  writeFileSync(file, String(content));
  return relative(ROOT, file);
}

/**
 * One line per gap, no mid-stream byte cuts: the FIRST line of each gap names
 * its cause (receipt gaps and gate gaps both lead with the command + exit).
 * Bounded surfaces show this; the evidence file holds everything.
 */
export function gapHeads(gaps, maxEach = 200) {
  return gaps.map((g) => String(g).split('\n')[0].slice(0, maxEach)).join(' | ');
}
