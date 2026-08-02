/**
 * Rule-first risk classifier (SRS FR-N2, BLUEPRINT §3.7, CONSTRAINTS.md C-5,
 * SECURITY_CONTROLS.md SC-10). Classification is a pure function of an
 * `ActionDescriptor` — no model call is on this path, so the same action
 * always classifies the same way (FR-N2's "classify deterministically from
 * rules with fixtures").
 *
 * A model MAY subsequently suggest a class (e.g. "this looks riskier than
 * the rule caught") — `combineRiskClass` only ever moves the effective
 * class to something *more* severe than the rule found, never less (FR-N2
 * "raise never lower"). The rule's own output is never itself replaced.
 */

import {
  RISK_CLASSES,
  type ActionDescriptor,
  type RiskClass,
} from './review-queue-types.js';

/**
 * The subset of the five risk classes that map onto CONSTRAINTS.md C-5's
 * NEVER-AUTO list (main merges, releases/deploys, destructive ops —
 * auth/crypto changes, new-stack additions, and scope-boundary breaks all
 * classify as `destructive` below). `escalation` and `budget` are still
 * classified (FR-N2 requires all five, deterministically) but are not in
 * this hard-block set: crossing an escalation tier or a spend threshold
 * already has its own park/token/breaker path (`loop-land-policy.ts`,
 * `@dokima/gateway`'s budget breakers) rather than the unconditional
 * "never execute in-loop" rule this set enforces.
 *
 * Exported as a frozen array (SC-10: "compiled into packages/harbormaster —
 * not config, not DB, no API mutates it") — there is no setter, and the
 * array identity is frozen so a caller holding a reference cannot mutate it
 * in place either.
 */
export const NEVER_AUTO_RISK_CLASSES: readonly RiskClass[] = Object.freeze([
  'deploy',
  'main-merge',
  'destructive',
]);

const DEPLOY_COMMAND_RE =
  /\b(deploy|release|publish|docker\s+push|kubectl\s+apply|npm\s+publish)\b/i;
const MAIN_BRANCH_RE = /^(main|master)$/i;
const DESTRUCTIVE_COMMAND_RE =
  /(rm\s+-rf|drop\s+table|truncate\s+table|delete\s+from\s+\S+\s*(;|$)|git\s+push\s+--force|git\s+reset\s+--hard)/i;
const AUTH_CRYPTO_PATH_RE = /(^|\/)(auth|crypto|secret|credential)/i;

function classifyDeploy(action: ActionDescriptor): boolean {
  if (action.kind && /^(deploy|release)$/i.test(action.kind)) return true;
  return typeof action.command === 'string' && DEPLOY_COMMAND_RE.test(action.command);
}

function classifyMainMerge(action: ActionDescriptor): boolean {
  return (
    typeof action.targetBranch === 'string' && MAIN_BRANCH_RE.test(action.targetBranch)
  );
}

function classifyDestructive(action: ActionDescriptor): boolean {
  if (typeof action.command === 'string' && DESTRUCTIVE_COMMAND_RE.test(action.command)) {
    return true;
  }
  if ((action.touchedPaths ?? []).some((p) => AUTH_CRYPTO_PATH_RE.test(p))) return true;
  if ((action.scopeViolations ?? []).length > 0) return true;
  if ((action.newDependencies ?? []).length > 0) return true;
  return false;
}

function classifyEscalation(action: ActionDescriptor): boolean {
  return action.escalation?.crossesNamedTier === true;
}

function classifyBudget(action: ActionDescriptor): boolean {
  return typeof action.spend?.fraction === 'number' && action.spend.fraction >= 1;
}

const RULES: Record<RiskClass, (action: ActionDescriptor) => boolean> = {
  deploy: classifyDeploy,
  'main-merge': classifyMainMerge,
  destructive: classifyDestructive,
  escalation: classifyEscalation,
  budget: classifyBudget,
};

/**
 * Deterministic rule-first classification. Checks classes in the canonical
 * severity order (`RISK_CLASSES`, most severe first) and returns the first
 * match — an action matching more than one rule is reported as the more
 * severe class, never silently as the less severe one.
 */
export function classifyByRules(action: ActionDescriptor): RiskClass | null {
  for (const riskClass of RISK_CLASSES) {
    if (RULES[riskClass](action)) return riskClass;
  }
  return null;
}

function severityOf(riskClass: RiskClass | null): number {
  if (riskClass === null) return -1;
  return RISK_CLASSES.length - 1 - RISK_CLASSES.indexOf(riskClass);
}

/**
 * FR-N2 "a model may raise a risk class, never lower it": the effective
 * class is whichever of (rule, model-suggested) is strictly more severe;
 * ties and downgrades keep the rule's own classification.
 */
export function combineRiskClass(
  ruleClass: RiskClass | null,
  modelSuggestedClass: RiskClass | null,
): RiskClass | null {
  return severityOf(modelSuggestedClass) > severityOf(ruleClass)
    ? modelSuggestedClass
    : ruleClass;
}

/** True when `riskClass` falls in the unconditional NEVER-AUTO block set. */
export function isNeverAuto(riskClass: RiskClass | null): boolean {
  return riskClass !== null && NEVER_AUTO_RISK_CLASSES.includes(riskClass);
}

export class NeverAutoExecutionBlockedError extends Error {
  constructor(public readonly riskClass: RiskClass) {
    super(
      `NEVER-AUTO: action classified '${riskClass}' may not execute in-loop — stage it and park the ticket in_review instead (CONSTRAINTS.md C-5, FR-H4).`,
    );
    this.name = 'NeverAutoExecutionBlockedError';
  }
}

/**
 * The single enforcement point (SC-10) a caller wiring this into the land
 * loop must go through before performing a side-effecting action: throws
 * when the effective classification is NEVER-AUTO, otherwise returns it so
 * the caller can build the review card with the same classification.
 */
export function assertExecutionAllowed(
  action: ActionDescriptor,
  modelSuggestedClass: RiskClass | null = null,
): RiskClass | null {
  const effective = combineRiskClass(classifyByRules(action), modelSuggestedClass);
  if (isNeverAuto(effective))
    throw new NeverAutoExecutionBlockedError(effective as RiskClass);
  return effective;
}
