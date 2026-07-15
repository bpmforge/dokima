import {
  requireHumanActor,
  type Actor,
  type RuleLifecycleState,
} from './findings-types.js';

/**
 * Rule lifecycle + FP bookkeeping (CODE_BOOK_PROTOCOL chapter of findings.ts — FR-RL1/2,
 * DATABASE.md §5b): `proposed -> shadow -> advisory -> gate -> deprecated`, human-only
 * transitions, sample-gated promotion, and trailing-FP auto-demotion flagging.
 */

export interface RuleState {
  readonly ruleId: string;
  readonly state: RuleLifecycleState;
  readonly fpWindowFindings: number;
  readonly fpWindowFps: number;
  /** Derived: fpWindowFps / fpWindowFindings, 0 when no findings observed yet. */
  readonly fpRate: number;
  readonly promotedAt: string | null;
  readonly demotionFlagged: boolean;
  readonly updatedAt: string;
}

export type RuleStateErrorCode =
  'UNKNOWN_RULE' | 'BELOW_SAMPLE_MINIMUM' | 'FP_RATE_TOO_HIGH' | 'INVALID_TRANSITION';

export class RuleStateError extends Error {
  readonly code: RuleStateErrorCode;

  constructor(code: RuleStateErrorCode, message: string) {
    super(message);
    this.name = 'RuleStateError';
    this.code = code;
  }
}

/** Trailing FP rate above this on a `gate`-state rule auto-flags demotion. */
export const DEMOTION_FP_THRESHOLD = 0.5;

export interface PromotionCriteria {
  readonly minSampleCount: number;
  readonly maxFpRate: number;
}

export interface RuleStateStore {
  readonly rules: readonly RuleState[];
  get(ruleId: string): RuleState | undefined;
  register(ruleId: string): RuleState;
  /** Folds one FP/TP outcome into the rule's trailing window; never call this for infra-failure-derived findings (R-D2). */
  recordOutcome(ruleId: string, isFalsePositive: boolean): RuleState;
  /** Human-only (FR-RL2: "No LLM code path can change a rule's state"). */
  transition(ruleId: string, to: RuleLifecycleState, actor: Actor): RuleState;
  /** shadow/advisory -> gate; refuses below the FP sample minimum or above the max FP rate, with counts shown. */
  promote(ruleId: string, actor: Actor, criteria: PromotionCriteria): RuleState;
}

export function createRuleStateStore(opts: { now?: () => string } = {}): RuleStateStore {
  const now = opts.now ?? (() => new Date().toISOString());
  const rules = new Map<string, RuleState>();

  function requireRule(ruleId: string): RuleState {
    const state = rules.get(ruleId);
    if (!state) {
      throw new RuleStateError('UNKNOWN_RULE', `rule "${ruleId}" is not registered`);
    }
    return state;
  }

  return {
    get rules() {
      return Array.from(rules.values());
    },
    get(ruleId) {
      return rules.get(ruleId);
    },
    register(ruleId) {
      if (rules.has(ruleId)) {
        return rules.get(ruleId)!;
      }
      const state: RuleState = {
        ruleId,
        state: 'proposed',
        fpWindowFindings: 0,
        fpWindowFps: 0,
        fpRate: 0,
        promotedAt: null,
        demotionFlagged: false,
        updatedAt: now(),
      };
      rules.set(ruleId, state);
      return state;
    },
    recordOutcome(ruleId, isFalsePositive) {
      const current = requireRule(ruleId);
      const fpWindowFindings = current.fpWindowFindings + 1;
      const fpWindowFps = current.fpWindowFps + (isFalsePositive ? 1 : 0);
      const fpRate = fpWindowFps / fpWindowFindings;
      const demotionFlagged =
        current.state === 'gate' && fpRate > DEMOTION_FP_THRESHOLD
          ? true
          : current.demotionFlagged;
      const updated: RuleState = {
        ...current,
        fpWindowFindings,
        fpWindowFps,
        fpRate,
        demotionFlagged,
        updatedAt: now(),
      };
      rules.set(ruleId, updated);
      return updated;
    },
    transition(ruleId, to, actor) {
      requireHumanActor(actor, `rule "${ruleId}" transition to "${to}"`);
      const current = requireRule(ruleId);
      const updated: RuleState = { ...current, state: to, updatedAt: now() };
      rules.set(ruleId, updated);
      return updated;
    },
    promote(ruleId, actor, criteria) {
      requireHumanActor(actor, `rule "${ruleId}" promotion`);
      const current = requireRule(ruleId);
      if (current.state !== 'shadow' && current.state !== 'advisory') {
        throw new RuleStateError(
          'INVALID_TRANSITION',
          `rule "${ruleId}" cannot promote to "gate" from state "${current.state}"`,
        );
      }
      if (current.fpWindowFindings < criteria.minSampleCount) {
        throw new RuleStateError(
          'BELOW_SAMPLE_MINIMUM',
          `rule "${ruleId}" promotion refused: ${current.fpWindowFindings} findings observed, ` +
            `minimum ${criteria.minSampleCount} required`,
        );
      }
      if (current.fpRate > criteria.maxFpRate) {
        throw new RuleStateError(
          'FP_RATE_TOO_HIGH',
          `rule "${ruleId}" promotion refused: FP rate ${current.fpRate} exceeds threshold ${criteria.maxFpRate} ` +
            `(${current.fpWindowFps}/${current.fpWindowFindings})`,
        );
      }
      const updated: RuleState = {
        ...current,
        state: 'gate',
        promotedAt: now(),
        demotionFlagged: false,
        updatedAt: now(),
      };
      rules.set(ruleId, updated);
      return updated;
    },
  };
}
