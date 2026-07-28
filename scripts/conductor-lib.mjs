// conductor-lib.mjs — pure, side-effect-free helpers extracted out of
// conductor.mjs so they can be unit-tested directly. conductor.mjs itself
// runs a real build harness as a top-level side effect on import (it calls
// `main()` at the bottom of the file), so it cannot be imported from a test
// without spawning git/claude sessions. These functions have no such
// side effect — importing this file does nothing but define functions and
// one constant object.
//
// W9-09: extraction only, no behavioural change. conductor.mjs imports these
// same functions instead of defining them inline; call sites and inputs are
// unchanged. Verified by running `node scripts/conductor.mjs --lint` (the
// one conductor.mjs mode with no git/process side effects) before and after
// the extraction and diffing byte-for-byte identical output — see the W9-09
// report for the literal before/after transcripts.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------- config ----------
// W9-10: boardPath is the project-relative path to the board file, so a repo
// whose board is not at the root (e.g. Kryptkeeper's docs/board/plan.json)
// can point the conductor at it via conductor.config.json. Default 'plan.json'
// preserves the pre-W9-10 root-board behaviour unchanged for repos (like this
// one) that don't set it.
export const DEFAULT_CONFIG = {
  branchPrefix: 'sw/',
  worktreeDir: '../.shipwright-worktrees',
  isolation: 'worktree',
  toolchainMarker: 'package.json',
  boardPath: 'plan.json',
  install: ['pnpm', ['install', '--prefer-offline']],
  gates: [
    ['pnpm', ['lint']],
    ['pnpm', ['typecheck']],
    ['pnpm', ['test']],
  ],
  gateTimeoutMin: 15,
  remotes: ['github', 'origin'],
  alwaysOk: [
    'plan.json',
    'docs/STATUS.md',
    'docs/work/**',
    'docs/TECH_STACK.md',
    'pnpm-lock.yaml',
    'package.json',
  ],
};

/** Shallow-merges a project's conductor.config.json over the defaults (same as the original `{ ...DEFAULT_CONFIG, ...override }`). */
export function mergeConfig(defaults, override) {
  return { ...defaults, ...override };
}

/**
 * The shared-infra allowlist a ticket may touch regardless of write_scope,
 * always including the configured board path even when a project's own
 * `alwaysOk` override forgets to list it — the board itself must always be
 * writable by the ticket that updates its own status. De-duplicates so the
 * common case (boardPath left at the default 'plan.json', already first in
 * DEFAULT_CONFIG.alwaysOk) doesn't produce a repeated glob.
 */
export function alwaysOkPatterns(config) {
  const boardPath = config.boardPath ?? 'plan.json';
  return [...new Set([...(config.alwaysOk ?? []), boardPath])];
}

// ---------- board load / serialize ----------
/** Resolves the on-disk board path: `boardPath` (project-relative, default 'plan.json') under `dir`. */
export const planPath = (dir, boardPath = 'plan.json') => resolve(dir, boardPath);

/** Loads and parses the board at `boardPath` (default 'plan.json') from `dir`. */
export function loadPlanFrom(dir, boardPath = 'plan.json') {
  return JSON.parse(readFileSync(planPath(dir, boardPath), 'utf8'));
}

/** Serializes a plan object back to the on-disk board format (2-space indent, trailing newline). */
export function serializePlan(plan) {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

/** The gate-check message when a ticket's board row isn't 'done' after a session — names the configured boardPath, not a hardcoded 'plan.json'. */
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
export function codingPrompt(t, feedback, boardPath = 'plan.json') {
  return `Read CLAUDE.md, MASTER_PROMPT.md and PLAYBOOK.md in this repo and obey them.
You are working EXACTLY ONE ticket from ${boardPath} and nothing else.

TICKET ${t.id} — ${t.title}
lane: ${t.lane} · write_scope: ${JSON.stringify(t.write_scope)}
acceptance:
${t.acceptance.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}
${feedback ? `\nA PREVIOUS ATTEMPT FAILED ITS GATES. You may be resuming partial work — inspect the current tree first. Gate failures to fix:\n${feedback.map((g) => `- ${g}`).join('\n')}\n` : ''}
Rules of engagement:
- You are already on the correct git branch in an isolated worktree. Never switch branches, never touch main, never push.
- Set the ticket in_progress in ${boardPath} first (commit), implement with tests per PLAYBOOK, stage explicit paths only, commit in small steps.
- Run the full gate yourself before closing (the project's lint/typecheck/test).
- When everything passes: set the ticket done in ${boardPath} + append the docs/STATUS.md line (same commit), then stop.
- If genuinely blocked after one honest attempt: set status blocked with a notes entry explaining exactly what is missing, then stop.
- An external conductor independently verifies your work; nothing you print is trusted, only repo state.`;
}

// ---------- misc pure helpers ----------
export const wave = (id) => id.split('-')[0];

export const nonWildPrefix = (glob) => glob.replace(/[*?].*$/, '');

export function globToRegex(glob) {
  // '\x01' is a sentinel for '**' chosen before '*' is expanded below, then
  // swapped back — split/join (not a regex literal) so the sentinel never
  // appears inside a RegExp pattern (no-control-regex).
  const esc = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\x01')
    .replace(/\*/g, '[^/]*')
    .split('\x01')
    .join('.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${esc}$`);
}

export function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}
