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

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
  // W3-15 portability: where THIS project pins its Node version. Shipwright
  // pins at the repo root; Kryptkeeper pins at ui/.nvmrc (its CI reads the same
  // file via node-version-file) and has no root .nvmrc. A project that pins
  // nowhere sets this to null, or simply has no such file — the check is then
  // skipped rather than fataling. Same defect class as W9-12's models.json:
  // an unconditional read of a Shipwright-shaped path at startup.
  nvmrcPath: '.nvmrc',
  // Warn when a ticket may write implementation but not its test siblings.
  // Off by default (null) so the script stays language-agnostic; a project
  // opts in, e.g. { source: '\\.go$', test: '_test\\.go$' }.
  testSibling: null,
  // Warn when two tickets claim the same versioned-migration number, or when a
  // ticket still to be built claims one that already exists. Off by default:
  // { pattern: '/(\\d{6})_', dirs: ['internal/db/migrations'] }
  migrationVersions: null,
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
  // W9-12: per-role model routing used to live in a separate scripts/models.json,
  // read unconditionally at module scope — a repo importing only conductor.mjs +
  // conductor-lib.mjs + conductor.config.json crashed with a bare ENOENT before
  // --lint or any argument parsing ran. Folding it in here makes the config
  // self-sufficient: a project's conductor.config.json can override any subset of
  // these via a top-level `models` key (mergeConfig replaces the whole object, same
  // shallow-merge convention as `gates`/`alwaysOk`), or omit `models` entirely and
  // get a working generic ladder out of the box.
  models: {
    maker: 'sonnet',
    cheap: 'haiku',
    reviewer: 'sonnet',
    security: 'sonnet',
    escalate: 'opus',
    cheapLanes: [],
    cheapMaxPoints: 0,
  },
};

/**
 * Validates a resolved `models` config (DEFAULT_CONFIG.models merged with a
 * project's conductor.config.json override) has every role the conductor
 * dispatches sessions to. Returns an array of human-readable problem
 * descriptions — empty when valid. Pure/side-effect-free so the caller
 * decides how to fail (conductor.mjs turns a non-empty result into a startup
 * error naming the missing keys, instead of an undefined-model crash deep
 * inside a session run).
 */
export function validateModels(models) {
  const errors = [];
  if (models === null || typeof models !== 'object') {
    return ["conductor.config.json's \"models\" key must be an object (or omitted to use the built-in default ladder)"];
  }
  for (const role of ['maker', 'cheap', 'reviewer', 'security', 'escalate']) {
    const v = models[role];
    if (typeof v !== 'string' || v.trim() === '') {
      errors.push(`models.${role} is required and must be a non-empty string (got ${JSON.stringify(v)})`);
    }
  }
  return errors;
}

/**
 * Pure claim filter — which tickets may be claimed next, in id order.
 *
 * `excluded` holds ids the CURRENT RUN must not claim again. This is what
 * makes `--no-merge` terminate: a parked ticket's `done` status is committed
 * only on its own branch and never merged, so the board at ROOT still reads
 * `todo`. Without the exclusion the loop re-claims the same ticket forever —
 * and because starting a ticket force-removes and recreates its worktree, each
 * re-claim RESETS the branch to main and destroys the parked work. Observed on
 * Kryptkeeper 2026-07-28: S-01 completed, reviewed APPROVE, parked, was
 * immediately re-claimed, and its three commits became unreachable.
 */
export function claimableTickets(plan, { waves = null, hold = [], excluded = [] } = {}) {
  const done = new Set(plan.tickets.filter((t) => t.status === 'done').map((t) => t.id));
  const busyLanes = new Set(plan.tickets.filter((t) => t.status === 'in_progress').map((t) => t.lane));
  const holdSet = new Set(hold);
  const excludedSet = new Set(excluded);
  return plan.tickets
    .filter((t) => t.status === 'todo')
    .filter((t) => !holdSet.has(t.id)) // F2: human-pair tickets are never claimed unattended
    .filter((t) => !excludedSet.has(t.id))
    .filter((t) => !waves || waves.includes(wave(t.id)))
    .filter((t) => (t.depends_on ?? []).every((d) => done.has(d)))
    .filter((t) => !busyLanes.has(t.lane))
    .sort((a, b) => a.id.localeCompare(b.id));
}


/**
 * Lint rule: a ticket whose write_scope can touch implementation files but not
 * their test siblings cannot add tests without tripping the out-of-scope gate.
 *
 * Kryptkeeper W6-01, 2026-07-28: the agent implemented HA leader election,
 * wrote five table-driven tests plus a prove-the-negative red-check, verified
 * them, then DELETED them and self-blocked — because write_scope listed three
 * .go files and no _test.go, and ALWAYS_OK carries no test pattern. It obeyed
 * MASTER_PROMPT's "never self-amend write_scope" rule and the harness punished
 * it for it. Catching this at filing time costs nothing; catching it mid-ticket
 * costs a full session and loses the tests.
 *
 * Returns a warning string, or null when the ticket is fine or the check is off.
 */
export function testSiblingWarning(ticket, cfg) {
  if (!cfg || !cfg.source || !cfg.test) return null;
  const sourceRe = new RegExp(cfg.source);
  const testRe = new RegExp(cfg.test);
  const scope = ticket.write_scope || [];
  const impl = scope.filter((f) => sourceRe.test(f) && !testRe.test(f));
  if (!impl.length) return null;
  if (scope.some((f) => testRe.test(f))) return null;
  return `${ticket.id}: write_scope has implementation (${impl.join(', ')}) but no test sibling matching ${cfg.test} — the agent cannot add tests without an out-of-scope gate failure`;
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
export function nodePinMismatch(nodeVersion, pinContents) {
  const want = String(pinContents ?? '').trim();
  if (!want) return null;
  if (nodeVersion.startsWith(`v${want}.`)) return null;
  return `node ${nodeVersion} != v${want}.x`;
}

/** Shallow-merges a project's conductor.config.json over the defaults (same as the original `{ ...DEFAULT_CONFIG, ...override }`). */
export function mergeConfig(defaults, override) {
  return { ...defaults, ...override };
}

/**
 * Loads conductor.config.json from `root` (project-specific settings) and
 * merges it over `defaults`, or returns `defaults` unchanged when the file
 * doesn't exist. W9-12 follow-up: this used to be an inline IIFE in
 * conductor.mjs with a bare `JSON.parse` — moving the per-role model
 * routing table INTO this same file (W9-12's main fix) meant a hand-edited
 * conductor.config.json with broken JSON (e.g. a trailing comma) threw a raw
 * SyntaxError from the module job at import time, before --lint or any
 * argument parsing ran — the exact failure SHAPE the models.json ENOENT had,
 * just moved one line earlier. Wrapping the parse here and re-throwing a
 * message that names the file and the parser's own reason lets the caller
 * (conductor.mjs) turn it into the same clean startup error + exit(1) it
 * already uses for an invalid `models` value, instead of a stack trace.
 */
export function loadConfigFile(root, defaults, fileName = 'conductor.config.json') {
  const f = resolve(root, fileName);
  if (!existsSync(f)) return defaults;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    throw new Error(`${fileName} is not valid JSON: ${e.message}`);
  }
  return mergeConfig(defaults, parsed);
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

/**
 * Whether every character in `text` is ASCII (code point <= 0x7f). Used to
 * detect a board file's own non-ASCII convention: the real plan.json is
 * entirely ASCII bytes on disk -- any non-ASCII content it carries
 * (section signs, em dashes, etc.) is JSON-escaped as \uXXXX rather than
 * written as literal UTF-8.
 */
function isAsciiOnly(text) {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/**
 * Re-escapes every non-ASCII UTF-16 code unit in `json` as a lowercase,
 * zero-padded \uXXXX sequence -- the convention the real plan.json uses on
 * disk (equivalent to Python's `json.dumps(..., ensure_ascii=True)`). Safe
 * to apply across the whole JSON.stringify output unconditionally:
 * non-ASCII characters can only occur inside quoted string literals, never
 * in JSON's structural syntax ({}[]:,), so there is nothing else in the
 * text this could corrupt. The match range (\u0080-\uffff) deliberately
 * starts above the ASCII control-character range (\x00-\x1f, \x7f) so it
 * never trips the no-control-regex lint rule -- see globToRegex's \x01
 * sentinel above for the same concern.
 */
function asciiEscapeNonAscii(json) {
  return json.replace(/[\u0080-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Serializes a plan object back to the on-disk board format: 2-space
 * indent, plus whatever convention the file being replaced already uses.
 * W9-11: a naive `JSON.stringify(plan, null, 2) + '\n'` diverges from the
 * real plan.json by thousands of bytes on every write -- it emits literal
 * UTF-8 where the file uses ASCII-escaping, and adds a trailing newline
 * the file doesn't have -- turning every status change into an
 * unreviewable ~400-line diff.
 *
 * `original` is the raw text of the file this write is about to replace.
 * When given, its two conventions are detected and preserved instead of
 * imposed:
 *   - non-ASCII escaping: only applied when `original` is itself pure
 *     ASCII (the real plan.json's convention). A file that already
 *     contains literal UTF-8 keeps that convention untouched -- this never
 *     forces ASCII-escaping on a file that wasn't already ASCII-only.
 *   - trailing newline: present in the output iff `original` had one.
 * Without `original` (e.g. writing a brand-new board), falls back to the
 * pre-W9-11 default: literal UTF-8, trailing newline.
 */
export function serializePlan(plan, original) {
  const json = JSON.stringify(plan, null, 2);
  const body = original !== undefined && isAsciiOnly(original) ? asciiEscapeNonAscii(json) : json;
  const trailingNewline = original === undefined || original.endsWith('\n');
  return trailingNewline ? `${body}\n` : body;
}

/**
 * Writes `plan` to the board at `boardPath` under `dir` -- the ONE place a
 * conductor board write happens, so byte-preservation (W9-11) is guaranteed
 * for every call site rather than relying on each one to remember to pass
 * `original` to serializePlan itself. Reads the file's current on-disk
 * bytes immediately before overwriting it (not e.g. bytes captured at
 * `loadPlan` time earlier in the same function) so the convention detected
 * is always the one actually being replaced. The file must already exist
 * -- both conductor.mjs call sites write only after a prior successful
 * `loadPlan` of this same path, so a missing file here would itself be a
 * bug worth throwing on, not one to paper over.
 */
export function writePlan(dir, plan, boardPath = 'plan.json') {
  const file = planPath(dir, boardPath);
  writeFileSync(file, serializePlan(plan, readFileSync(file, 'utf8')));
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

/**
 * Decide what a review verdict actually means for the retry loop.
 *
 * Severity policy: only CRITICAL/HIGH findings, plus prior findings the reviewer
 * explicitly marks STILL PRESENT, block a ticket. That policy has a sharp edge —
 * a FIX verdict carrying nothing but MEDIUM/LOW findings produces an EMPTY
 * blocker list. Retrying on an empty list asks the agent to fix nothing, burns a
 * session, and when attempts run out blocks the ticket with an empty ledger:
 * "blocked" with no recorded reason, which is the worst of both outcomes.
 *
 * Observed on Kryptkeeper S-30, 2026-07-29:
 *   review.result  verdict=FIX newHigh=0 priorsStillPresent=0 (sticky-seen 0)
 *   review.fix     0 blocker(s): 0 new + 0 still-present
 *   ticket.retry   attempt 2
 *
 * So: the presence of blockers is the decision, not the verdict string. The
 * reviewer is the authority on whether something blocks; the severity filter is
 * how that authority is expressed. Sub-blocking findings are returned as
 * `advisory` so they are recorded rather than silently dropped.
 */
export function reviewDecision(verdict) {
  const v = verdict ?? {};
  const findings = Array.isArray(v.findings) ? v.findings : [];
  const priors = Array.isArray(v.prior_status) ? v.prior_status : [];

  const isBlocking = (f) => ['CRITICAL', 'HIGH'].includes(f?.severity);
  const currentHigh = findings.filter(isBlocking);
  const presentPriors = priors.filter((ps) => ps?.status === 'PRESENT');

  const blockers = [
    ...currentHigh.map((f) => `[${f.severity}] ${f.file}: ${f.issue} — fix: ${f.fix}`),
    ...presentPriors.map((ps) => `[STILL-PRESENT] ${ps.finding} — ${ps.evidence || ''}`),
  ];

  return {
    approve: blockers.length === 0,
    blockers,
    currentHigh,
    presentPriors,
    advisory: findings.filter((f) => !isBlocking(f)),
    // True when the reviewer said FIX but raised nothing that blocks — the case
    // that used to spin. Callers log it so the override stays visible.
    verdictOverridden: blockers.length === 0 && v.verdict !== 'APPROVE',
  };
}
