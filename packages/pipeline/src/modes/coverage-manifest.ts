/**
 * Onboard run coverage manifest (W8-08 AC2, R-E3 "name-ALL-of-the-set"
 * lesson, D-014 rule lifecycle). `run/run-onboard.ts` attaches
 * `ONBOARD_COVERAGE_MANIFEST` to every `OnboardRunResult` unchanged — this
 * module owns the two named-by-name sets and their D-014
 * `proposed|shadow|advisory|gate|deprecated` tags; the executor never
 * builds or judges this list itself (Law 6: `runOnboard` never authors
 * content or promotes/demotes a rule — D-014 reserves that to a human plus
 * measured FP evidence).
 *
 * **Anti-slop rules — "30 rules" is R-01..R-30 structurally, not 30 rows
 * parsed from one file.** `content/protocols/ANTI_SLOP_RULES.md` only
 * documents R-01..R-29 as `### R-nn` headings; R-30 ("library-shaped
 * reimplementation") exists only in `content/experts/code-review/
 * anti-slop-auditor.md`'s description and checklist, not yet folded back
 * into the canonical rules doc. That inconsistency is itself the reason
 * R-30 is tagged `shadow` below rather than `advisory` alongside its peers
 * — an anti-slop rule this package can't even point at one canonical
 * definition for isn't one a fake dispatch port should treat as reliably
 * enforced. Names/ids for R-01..R-29 are transcribed verbatim from that
 * doc's headings (`coverage-manifest.test.ts` parses the file and asserts
 * exact parity, so this list can't silently drift from the source).
 *
 * **Validators — the *imported* set, not every script on disk.**
 * `content/validators/` currently holds 78 executable scripts (`validate-*`
 * / `run-*` / `secrets-scan`, `pack.ts`'s own discovery pattern — the
 * codebase's existing definition of "a validator", reused here rather than
 * inventing a second one), but two of them (`secrets-scan.sh`, W3-13;
 * `validate-remote-parity.sh`, FR-I2) are natively Shipwright-authored, not
 * part of the bpm-opencode-experts import (no `Provenance:` header, unlike
 * every one of the other 76 — `coverage-manifest.test.ts` re-derives this
 * split from disk at test time and asserts it). AC2 asks for "the imported
 * rule set" specifically, so `VALIDATOR_NAMES` is exactly those 76 —
 * docs elsewhere in this repo (SRS FR-E1, STATUS.md) say "66" from the
 * W1-01 import baseline; the library has grown since (data-governance,
 * resilience-patterns, iac, and others landed in later design tickets), so
 * 76 is the current, provably-real count, not the stale figure.
 *
 * **Tagging — recorded declared state, never a promotion.** D-014 forbids
 * an LLM (or this pure module) deciding a rule is safe to gate; every
 * `gate`/`advisory` tag below instead cites an *already-existing* fact
 * elsewhere in this repo:
 *   - `gate`: the validator appears in `phases/topology.ts`'s phase 4 or 5
 *     validator set (`waiverEligible: false` — Law 3's non-waivable build/
 *     launch gates), OR the anti-slop rule is one of the six
 *     `anti-slop-auditor.md` checklist calls out by ID as a blocking
 *     violation (R-01, R-02, R-13, R-15, R-17, R-18).
 *   - `advisory`: the validator appears in a waiver-eligible phase
 *     (0–3) validator set but never in phase 4/5; every other anti-slop
 *     rule that has a stable, single-source definition (R-03..R-29 minus
 *     the six gate ids).
 *   - `shadow`: everything else — validators never wired into
 *     `phases/topology.ts` at all, plus R-30 (see above).
 * No rule here is promoted/demoted by this module; `buildOnboardCoverageManifest`
 * only reads `PHASES` and reports what's already true.
 */
import { PHASES } from '../phases/topology.js';

export type RuleLifecycleState =
  'proposed' | 'shadow' | 'advisory' | 'gate' | 'deprecated';

export interface AntiSlopRuleCoverageEntry {
  readonly id: string;
  readonly name: string;
  readonly state: RuleLifecycleState;
}

export interface ValidatorCoverageEntry {
  readonly name: string;
  readonly state: RuleLifecycleState;
}

export interface OnboardCoverageManifest {
  readonly antiSlopRules: readonly AntiSlopRuleCoverageEntry[];
  readonly validators: readonly ValidatorCoverageEntry[];
}

/** R-01..R-29 transcribed verbatim from `content/protocols/ANTI_SLOP_RULES.md`
 * `### R-nn <name>` headings; R-30 from `anti-slop-auditor.md` (see header). */
const ANTI_SLOP_RULE_NAMES: readonly [id: string, name: string][] = [
  ['R-01', 'Catch-all swallowing'],
  ['R-02', 'try/catch inside tight loops'],
  ['R-03', 'Exception-driven control flow'],
  ['R-04', 'Serial awaits that block parallelism'],
  ['R-05', 'Single-implementation interfaces/factories'],
  ['R-06', 'Delegation-only wrapper classes'],
  ['R-07', 'Single-use helper functions'],
  ['R-08', 'Repository pattern on simple CRUD'],
  ['R-09', 'Null checks on types you control'],
  ['R-10', 'Fallback values that hide failures'],
  ['R-11', 'Unspecified retry logic'],
  ['R-12', 'Feature flags on unreleased code'],
  ['R-13', 'What-comments'],
  ['R-14', 'Step-by-step narration blocks'],
  ['R-15', 'Stale JSDoc / docstring parameters'],
  ['R-16', 'Emojis in code comments'],
  ['R-17', 'Speculative generalization'],
  ['R-18', 'Cargo-cult patterns'],
  ['R-19', 'Duplicated blocks (copy-paste growth)'],
  ['R-20', 'Inconsistent pattern usage'],
  ['R-21', 'Hallucinated Package Names (Slopsquatting)'],
  ['R-22', 'Architectural Privilege Escalation Paths'],
  ['R-23', 'Elevated Credential Leakage Rate'],
  ['R-24', 'Docstring Inflation (Logic Density Ratio violation)'],
  ['R-25', 'Phantom Imports'],
  ['R-26', 'Disconnected Pipelines (Dead Scaffolding)'],
  ['R-27', 'Unimplemented Stubs as Features'],
  ['R-28', 'LLM Output Consumed Without Validation'],
  ['R-29', 'Prose Padding (Local LLM Output Slop)'],
  ['R-30', 'Library-shaped reimplementation'],
];

/** anti-slop-auditor.md's checklist: "Blocking violations (R-01, R-02, R-13,
 * R-15, R-17, R-18) clearly marked" — the only anti-slop rules a source doc
 * declares as gate-tier today. */
const GATE_ANTI_SLOP_RULE_IDS: ReadonlySet<string> = new Set([
  'R-01',
  'R-02',
  'R-13',
  'R-15',
  'R-17',
  'R-18',
]);

/** R-30 has no single canonical definition yet (see header) — shadow, not advisory. */
const SHADOW_ANTI_SLOP_RULE_IDS: ReadonlySet<string> = new Set(['R-30']);

/** The 76 validators imported from bpm-opencode-experts (provenance-headed) —
 * excludes the 2 natively Shipwright-authored scripts (`secrets-scan`,
 * `validate-remote-parity`); see header + coverage-manifest.test.ts. */
const VALIDATOR_NAMES: readonly string[] = [
  'run-coverage-loop',
  'run-handoff-gates',
  'validate-adrs',
  'validate-api-consistency',
  'validate-api-coverage',
  'validate-architecture',
  'validate-autonomy-ledger',
  'validate-autonomy-wiring',
  'validate-book-structure',
  'validate-build',
  'validate-c3-coverage',
  'validate-challenger-gate',
  'validate-circular-deps',
  'validate-close-receipt',
  'validate-code-health',
  'validate-completion-manifest',
  'validate-contract-conformance',
  'validate-data-governance',
  'validate-dead-code',
  'validate-deps',
  'validate-design-system',
  'validate-design-tokens',
  'validate-doc-catalog',
  'validate-doc-counts',
  'validate-doc-render-health',
  'validate-e2e-setup',
  'validate-entry-points',
  'validate-erd-coverage',
  'validate-feature-coverage',
  'validate-file-size',
  'validate-fix-backlog-closed',
  'validate-flows',
  'validate-handoff-discipline',
  'validate-iac',
  'validate-improve-coverage',
  'validate-infrastructure',
  'validate-inventory',
  'validate-jira-hygiene',
  'validate-lint',
  'validate-loop-readiness',
  'validate-mermaid',
  'validate-migrations',
  'validate-model-pins',
  'validate-module-boundaries',
  'validate-module-boundaries-transitive',
  'validate-module-design',
  'validate-no-ascii-art',
  'validate-no-reinvent',
  'validate-observability',
  'validate-owasp',
  'validate-persistence-block',
  'validate-phase-gate',
  'validate-release-readiness',
  'validate-requirement-closure',
  'validate-requirements-matrix',
  'validate-resilience-patterns',
  'validate-scope',
  'validate-security-controls',
  'validate-sequence-coverage',
  'validate-smoke',
  'validate-spec-traceability',
  'validate-state-drift',
  'validate-status-freshness',
  'validate-tech-stack',
  'validate-test-design',
  'validate-tests',
  'validate-tests-mapping',
  'validate-ticket-hygiene',
  'validate-tickets',
  'validate-tracker-fresh',
  'validate-tracker-integrity',
  'validate-use-cases',
  'validate-user-stories',
  'validate-ux-spec',
  'validate-vendor-provenance',
  'validate-wcag-coverage',
];

function computeValidatorTagSets(): {
  readonly gate: ReadonlySet<string>;
  readonly advisory: ReadonlySet<string>;
} {
  const gate = new Set<string>();
  const advisory = new Set<string>();
  for (const phase of PHASES) {
    const target = phase.waiverEligible ? advisory : gate;
    for (const name of phase.validators) target.add(name);
  }
  for (const name of gate) advisory.delete(name);
  return { gate, advisory };
}

function antiSlopRuleState(id: string): RuleLifecycleState {
  if (GATE_ANTI_SLOP_RULE_IDS.has(id)) return 'gate';
  if (SHADOW_ANTI_SLOP_RULE_IDS.has(id)) return 'shadow';
  return 'advisory';
}

/**
 * Builds the coverage manifest fresh each call — deterministic, no
 * mutable module state, safe to call from a pure `runOnboard` (Law 9: no
 * network, no fs; every input here is a literal or `phases/topology.ts`'s
 * already-pure `PHASES` table).
 */
export function buildOnboardCoverageManifest(): OnboardCoverageManifest {
  const { gate, advisory } = computeValidatorTagSets();
  return {
    antiSlopRules: ANTI_SLOP_RULE_NAMES.map(([id, name]) => ({
      id,
      name,
      state: antiSlopRuleState(id),
    })),
    validators: VALIDATOR_NAMES.map((name) => ({
      name,
      state: gate.has(name) ? 'gate' : advisory.has(name) ? 'advisory' : 'shadow',
    })),
  };
}
