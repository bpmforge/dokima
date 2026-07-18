/**
 * Rule lifecycle admin persistence (D-014, FR-RL2, DATABASE.md §5b). Mirrors
 * packages/loop/src/findings-rules.ts's state machine and promotion gate —
 * that package isn't reachable from apps/server (see settings-db.ts's header
 * for why) so the same `proposed -> shadow -> advisory -> gate -> deprecated`
 * ladder and data-gated promotion are reimplemented against the project's
 * own `rule_state` table instead.
 *
 * v1's API is single-user (API_DESIGN §1: "berth and agent actions never
 * come through this API" — only the authenticated operator can call these
 * routes), so FR-RL2's "LLMs never promote/demote" is satisfied by
 * construction here; `actorId` is still recorded for the audit trail every
 * settings mutation gets (FR-S3).
 */

import { withSettingsReader, withSettingsWriter } from './settings-db.js';
import {
  DEMOTION_FP_THRESHOLD,
  RULE_LIFECYCLE_ORDER,
  type RuleLifecycleState,
  type RuleStateRow,
} from './settings-types.js';

interface RuleStateSqlRow {
  rule_id: string;
  state: string;
  fp_window_findings: number;
  fp_window_fps: number;
  promoted_at: string | null;
  demotion_flagged: number;
  updated_at: string;
}

function fromSqlRow(row: RuleStateSqlRow): RuleStateRow {
  const fpRate =
    row.fp_window_findings > 0 ? row.fp_window_fps / row.fp_window_findings : 0;
  return {
    ruleId: row.rule_id,
    state: row.state as RuleLifecycleState,
    fpWindowFindings: row.fp_window_findings,
    fpWindowFps: row.fp_window_fps,
    fpRate,
    promotedAt: row.promoted_at,
    demotionFlagged: row.demotion_flagged !== 0,
    updatedAt: row.updated_at,
  };
}

const SELECT_ALL = 'SELECT * FROM rule_state ORDER BY rule_id';
const SELECT_ONE = 'SELECT * FROM rule_state WHERE rule_id = ?';

export async function listRuleStates(projectPath: string): Promise<RuleStateRow[]> {
  return withSettingsReader(projectPath, [], (db) => {
    const rows = db.prepare(SELECT_ALL).all() as RuleStateSqlRow[];
    return rows.map(fromSqlRow);
  });
}

/** Registers a rule at `proposed` if it isn't already tracked (idempotent — the settings UI calls this before promote/demote on an unknown rule id). */
export async function registerRule(
  projectPath: string,
  ruleId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<RuleStateRow> {
  return withSettingsWriter(projectPath, (db) => {
    db.prepare(
      `INSERT INTO rule_state (rule_id, state, fp_window_findings, fp_window_fps, updated_at)
       VALUES (?, 'proposed', 0, 0, ?)
       ON CONFLICT(rule_id) DO NOTHING`,
    ).run(ruleId, now());
    const row = db.prepare(SELECT_ONE).get(ruleId) as RuleStateSqlRow;
    return fromSqlRow(row);
  });
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

export interface PromotionCriteria {
  readonly minSampleCount: number;
  readonly maxFpRate: number;
}

/** D-014 defaults: at least 20 sampled findings, trailing FP rate under 20%, before a rule may hold real gate power. */
export const DEFAULT_PROMOTION_CRITERIA: PromotionCriteria = {
  minSampleCount: 20,
  maxFpRate: 0.2,
};

function nextState(state: RuleLifecycleState): RuleLifecycleState | undefined {
  const index = RULE_LIFECYCLE_ORDER.indexOf(state);
  return RULE_LIFECYCLE_ORDER[index + 1];
}

function previousState(state: RuleLifecycleState): RuleLifecycleState | undefined {
  const index = RULE_LIFECYCLE_ORDER.indexOf(state);
  return index > 0 ? RULE_LIFECYCLE_ORDER[index - 1] : undefined;
}

/** Human-confirmed promotion (FR-RL2): refuses below the sample minimum or above the max FP rate, with counts shown in the error. Promoting into `gate` is where the data gate actually bites; earlier rungs only need the FP window to already look healthy. */
export async function promoteRule(
  projectPath: string,
  ruleId: string,
  criteria: PromotionCriteria = DEFAULT_PROMOTION_CRITERIA,
  now: () => string = () => new Date().toISOString(),
): Promise<RuleStateRow> {
  return withSettingsWriter(projectPath, (db) => {
    const sqlRow = db.prepare(SELECT_ONE).get(ruleId) as RuleStateSqlRow | undefined;
    if (!sqlRow) {
      throw new RuleStateError('UNKNOWN_RULE', `rule "${ruleId}" is not registered`);
    }
    const row = fromSqlRow(sqlRow);
    const target = nextState(row.state);
    if (!target) {
      throw new RuleStateError(
        'INVALID_TRANSITION',
        `rule "${ruleId}" is already at its terminal state "${row.state}"`,
      );
    }
    if (target === 'gate') {
      if (row.fpWindowFindings < criteria.minSampleCount) {
        throw new RuleStateError(
          'BELOW_SAMPLE_MINIMUM',
          `rule "${ruleId}" has ${row.fpWindowFindings} sampled findings, needs >= ${criteria.minSampleCount} before promotion to gate`,
        );
      }
      if (row.fpRate > criteria.maxFpRate) {
        throw new RuleStateError(
          'FP_RATE_TOO_HIGH',
          `rule "${ruleId}" measured FP rate ${row.fpRate.toFixed(3)} exceeds max ${criteria.maxFpRate} (${row.fpWindowFps}/${row.fpWindowFindings})`,
        );
      }
    }
    const nowIso = now();
    db.prepare(
      `UPDATE rule_state SET state = ?, promoted_at = ?, demotion_flagged = 0, updated_at = ? WHERE rule_id = ?`,
    ).run(target, nowIso, nowIso, ruleId);
    return fromSqlRow(db.prepare(SELECT_ONE).get(ruleId) as RuleStateSqlRow);
  });
}

/** Human-confirmed demotion — always allowed (the safety direction never needs a data gate); clears any auto-demotion flag. */
export async function demoteRule(
  projectPath: string,
  ruleId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<RuleStateRow> {
  return withSettingsWriter(projectPath, (db) => {
    const sqlRow = db.prepare(SELECT_ONE).get(ruleId) as RuleStateSqlRow | undefined;
    if (!sqlRow) {
      throw new RuleStateError('UNKNOWN_RULE', `rule "${ruleId}" is not registered`);
    }
    const row = fromSqlRow(sqlRow);
    const target = previousState(row.state);
    if (!target) {
      throw new RuleStateError(
        'INVALID_TRANSITION',
        `rule "${ruleId}" is already at its lowest state "${row.state}"`,
      );
    }
    const nowIso = now();
    db.prepare(
      `UPDATE rule_state SET state = ?, demotion_flagged = 0, updated_at = ? WHERE rule_id = ?`,
    ).run(target, nowIso, ruleId);
    return fromSqlRow(db.prepare(SELECT_ONE).get(ruleId) as RuleStateSqlRow);
  });
}

/** Folds one FP/TP outcome into the rule's trailing window; auto-flags demotion once trailing FP exceeds DEMOTION_FP_THRESHOLD on a `gate`-state rule. No live findings producer is wired to call this yet (packages/loop isn't reachable from apps/server) — exposed so a future ticket, or a manual review action, can record outcomes honestly rather than this ticket fabricating history. */
export async function recordRuleOutcome(
  projectPath: string,
  ruleId: string,
  isFalsePositive: boolean,
  now: () => string = () => new Date().toISOString(),
): Promise<RuleStateRow> {
  return withSettingsWriter(projectPath, (db) => {
    const sqlRow = db.prepare(SELECT_ONE).get(ruleId) as RuleStateSqlRow | undefined;
    if (!sqlRow) {
      throw new RuleStateError('UNKNOWN_RULE', `rule "${ruleId}" is not registered`);
    }
    const findings = sqlRow.fp_window_findings + 1;
    const fps = sqlRow.fp_window_fps + (isFalsePositive ? 1 : 0);
    const fpRate = fps / findings;
    const demotionFlagged = sqlRow.state === 'gate' && fpRate > DEMOTION_FP_THRESHOLD;
    db.prepare(
      `UPDATE rule_state SET fp_window_findings = ?, fp_window_fps = ?, demotion_flagged = ?, updated_at = ? WHERE rule_id = ?`,
    ).run(findings, fps, demotionFlagged ? 1 : 0, now(), ruleId);
    return fromSqlRow(db.prepare(SELECT_ONE).get(ruleId) as RuleStateSqlRow);
  });
}
