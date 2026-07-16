import { describe, expect, it } from 'vitest';
import {
  assertExecutionAllowed,
  classifyByRules,
  combineRiskClass,
  isNeverAuto,
  NEVER_AUTO_RISK_CLASSES,
  NeverAutoExecutionBlockedError,
} from './review-queue-classifier.js';
import {
  RISK_CLASSES,
  type ActionDescriptor,
  type RiskClass,
} from './review-queue-types.js';

describe('classifyByRules — one fixture per risk class (FR-N2 acceptance 3)', () => {
  it('classifies a release/deploy command as deploy', () => {
    const action: ActionDescriptor = { command: 'npm publish --tag latest' };
    expect(classifyByRules(action)).toBe('deploy');
  });

  it('classifies a targetBranch of main as main-merge', () => {
    const action: ActionDescriptor = { targetBranch: 'main' };
    expect(classifyByRules(action)).toBe('main-merge');
  });

  it('classifies a destructive shell command as destructive', () => {
    const action: ActionDescriptor = { command: 'rm -rf /var/data' };
    expect(classifyByRules(action)).toBe('destructive');
  });

  it('classifies an auth/crypto path touch as destructive', () => {
    const action: ActionDescriptor = { touchedPaths: ['packages/auth/src/session.ts'] };
    expect(classifyByRules(action)).toBe('destructive');
  });

  it('classifies a write-scope violation as destructive (scope-boundary break)', () => {
    const action: ActionDescriptor = { scopeViolations: ['packages/other/src/index.ts'] };
    expect(classifyByRules(action)).toBe('destructive');
  });

  it('classifies a new dependency as destructive (new-stack addition)', () => {
    const action: ActionDescriptor = { newDependencies: ['some-new-lib'] };
    expect(classifyByRules(action)).toBe('destructive');
  });

  it('classifies a named-tier escalation crossing as escalation', () => {
    const action: ActionDescriptor = {
      escalation: { fromTier: 'R2', toTier: 'R3', crossesNamedTier: true },
    };
    expect(classifyByRules(action)).toBe('escalation');
  });

  it('classifies a 100%+ spend fraction as budget', () => {
    const action: ActionDescriptor = { spend: { fraction: 1 } };
    expect(classifyByRules(action)).toBe('budget');
  });

  it('classifies a plain, harmless action as no risk class', () => {
    const action: ActionDescriptor = { command: 'echo hello' };
    expect(classifyByRules(action)).toBeNull();
  });

  it('an escalation crossing that has not reached a named tier is not classified escalation', () => {
    const action: ActionDescriptor = {
      escalation: { fromTier: 'R0', toTier: 'R1', crossesNamedTier: false },
    };
    expect(classifyByRules(action)).toBeNull();
  });

  it('a sub-100% spend fraction is not classified budget', () => {
    const action: ActionDescriptor = { spend: { fraction: 0.85 } };
    expect(classifyByRules(action)).toBeNull();
  });

  it('resolves a doubly-matching action to the more severe of the two classes', () => {
    // command matches both the deploy pattern and would also be on a main
    // branch — deploy (index 0) outranks main-merge (index 1).
    const action: ActionDescriptor = { command: 'npm publish', targetBranch: 'main' };
    expect(classifyByRules(action)).toBe('deploy');
  });
});

describe('NEVER_AUTO_RISK_CLASSES (CONSTRAINTS.md C-5, SC-10)', () => {
  it('contains exactly the classes the NEVER-AUTO list maps onto', () => {
    expect([...NEVER_AUTO_RISK_CLASSES].sort()).toEqual([
      'deploy',
      'destructive',
      'main-merge',
    ]);
  });

  it('is frozen — cannot be mutated at runtime', () => {
    expect(Object.isFrozen(NEVER_AUTO_RISK_CLASSES)).toBe(true);
    expect(() => {
      // @ts-expect-error — arrays created with Object.freeze reject push in strict mode
      NEVER_AUTO_RISK_CLASSES.push('escalation');
    }).toThrow();
  });

  it('escalation and budget are classified but NOT in the never-auto block set', () => {
    expect(isNeverAuto('escalation')).toBe(false);
    expect(isNeverAuto('budget')).toBe(false);
  });

  it('every never-auto class reports isNeverAuto true, and null reports false', () => {
    for (const riskClass of NEVER_AUTO_RISK_CLASSES) {
      expect(isNeverAuto(riskClass)).toBe(true);
    }
    expect(isNeverAuto(null)).toBe(false);
  });
});

const ALL_CLASSES: readonly (RiskClass | null)[] = [null, ...RISK_CLASSES];

describe('combineRiskClass — model may raise, never lower (FR-N2, property test)', () => {
  /** Higher number = more severe; mirrors RISK_CLASSES' documented order (most severe first). */
  const severity = (c: RiskClass | null): number =>
    c === null ? -1 : RISK_CLASSES.length - 1 - RISK_CLASSES.indexOf(c);

  it('is never less severe than the rule classification, for every possible pairing', () => {
    // Exhaustive over the finite 6x6 domain (null + 5 classes) — a stronger
    // guarantee than a randomized sample for a domain this small.
    for (const ruleClass of ALL_CLASSES) {
      for (const modelClass of ALL_CLASSES) {
        const effective = combineRiskClass(ruleClass, modelClass);
        expect(severity(effective)).toBeGreaterThanOrEqual(severity(ruleClass));
      }
    }
  });

  it('ignores a model-suggested downgrade and keeps the rule class', () => {
    expect(combineRiskClass('deploy', 'budget')).toBe('deploy');
    expect(combineRiskClass('main-merge', null)).toBe('main-merge');
  });

  it('honors a model-suggested upgrade over the rule class', () => {
    expect(combineRiskClass('budget', 'deploy')).toBe('deploy');
    expect(combineRiskClass(null, 'destructive')).toBe('destructive');
  });

  it('keeps the rule class on a tie (equal severity, including both null)', () => {
    expect(combineRiskClass('escalation', 'escalation')).toBe('escalation');
    expect(combineRiskClass(null, null)).toBeNull();
  });
});

describe('assertExecutionAllowed — the single enforcement point (SC-10, FR-H4)', () => {
  it('throws NeverAutoExecutionBlockedError for a main-merge action', () => {
    const action: ActionDescriptor = { targetBranch: 'main' };
    expect(() => assertExecutionAllowed(action)).toThrow(NeverAutoExecutionBlockedError);
  });

  it('throws for a rule-safe action a model tries to upgrade into a never-auto class', () => {
    const action: ActionDescriptor = { command: 'echo hello' };
    expect(() => assertExecutionAllowed(action, 'destructive')).toThrow(
      NeverAutoExecutionBlockedError,
    );
  });

  it('still throws when a model tries to downgrade a rule-flagged never-auto action', () => {
    const action: ActionDescriptor = { targetBranch: 'main' };
    // A model suggesting 'budget' (less severe) cannot rescue a rule-flagged main-merge.
    expect(() => assertExecutionAllowed(action, 'budget')).toThrow(
      NeverAutoExecutionBlockedError,
    );
  });

  it('returns the effective class and does not throw for a non-never-auto class', () => {
    const action: ActionDescriptor = { spend: { fraction: 1 } };
    expect(assertExecutionAllowed(action)).toBe('budget');
  });

  it('returns null and does not throw for a harmless action', () => {
    const action: ActionDescriptor = { command: 'echo hello' };
    expect(assertExecutionAllowed(action)).toBeNull();
  });
});
