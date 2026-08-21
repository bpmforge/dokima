/**
 * D-018 escalation policy modes, reproduced at the Harbormaster loop level
 * (BLUEPRINT §3.3, F1 split 3/3): `ladder` (default, unchanged), `locked`
 * ("loops until it passes" — retries the SAME tier under a convergence
 * ceiling, then parks, never escalates), `token-gated` (climbs like
 * `ladder` up to a named tier boundary, then requires an approval-minted
 * escalation token before crossing it).
 *
 * `@dokima/gateway` already implements this exact state machine
 * (`escalation/policy.ts`'s `resolveEscalationPolicy`/`runEscalationPolicy`)
 * but that module is not re-exported from `escalation/index.ts` or the
 * package's top-level barrel — `packages/gateway/package.json`'s `exports`
 * map only publishes `src/index.ts`, so `resolveEscalationPolicy`,
 * `CONVERGENCE_CEILING`, and the mode types are unreachable from here (a
 * barrel gap, same class as W3-01a's harbormaster-deps seam — outside this
 * ticket's write_scope to fix; see the HANDOFF note in this ticket's
 * plan.json entry). The mode SHAPE is reproduced structurally rather than
 * imported, the same discipline `@dokima/gateway`'s own
 * `escalation/types.ts` uses for `FailureReceipt` ("this package cannot
 * depend on [it]... so the shape is reproduced rather than imported").
 *
 * This loop also deliberately does NOT delegate to `runEscalationPolicy`
 * even where reachable in principle: that engine additionally drives
 * model-chain selection via a `ScopedRoleMatrix` (a concern this loop, like
 * `loop-claim.ts`, stays agnostic to — `spawn` is an opaque injected
 * session runner, never model-routed here), and its `ladder` mode's R0
 * memory-hit resolves WITHOUT ever running an attempt or the close gate —
 * a ticket would stay `in_progress`+unclosed while the ladder reports
 * "resolved". Only the mode's documented shape and ceiling values are
 * reused; the loop's own attempt/park logic lives in `loop-land.ts`.
 */

import type { SpawnSession } from '@dokima/loop';

export type LandEscalationMode = 'ladder' | 'locked' | 'token-gated';

/** The tiers a policy can meaningfully pin or gate on (mirrors gateway's `PolicyRung`). */
export type PolicyRung = 'R1' | 'R2' | 'R3';

/** This loop's own rung<->attempt-count convention (no model-routed rungs of its own): R1/R2/R3 map to attempts 1/2/3. */
const POLICY_RUNG_ATTEMPT: Readonly<Record<PolicyRung, number>> = { R1: 1, R2: 2, R3: 3 };

export function attemptNumberForRung(rung: PolicyRung): number {
  return POLICY_RUNG_ATTEMPT[rung];
}

/** FR-L7's tier-aware convergence ceiling: capped 8 on frontier/metered tiers, 12 on local/owned-hardware tiers — reproduced from gateway's `escalation/policy-types.ts` (see module doc: unreachable via the public barrel). */
export type TierKind = 'metered' | 'local';

export const LAND_CONVERGENCE_CEILING: Readonly<Record<TierKind, number>> = {
  metered: 8,
  local: 12,
};

export interface LadderLandPolicy {
  readonly mode: 'ladder';
}

export const LADDER_LAND_POLICY: LadderLandPolicy = { mode: 'ladder' };

export interface LockedLandPolicy {
  readonly mode: 'locked';
  readonly pinnedTier: PolicyRung;
  readonly tierKind: TierKind;
}

export interface TokenGatedLandPolicy {
  readonly mode: 'token-gated';
  /** Climbing past this tier requires a minted escalation token. */
  readonly namedTier: PolicyRung;
}

export type LandEscalationPolicy =
  LadderLandPolicy | LockedLandPolicy | TokenGatedLandPolicy;

/** Three-scope map of policy by role (run > project > global, FR-S1), mirroring gateway's `ScopedEscalationPolicy`. */
export interface ScopedLandEscalationPolicy {
  readonly global?: Partial<Record<string, LandEscalationPolicy>>;
  readonly project?: Partial<Record<string, LandEscalationPolicy>>;
  readonly run?: Partial<Record<string, LandEscalationPolicy>>;
}

/** Resolves the role's escalation policy across run > project > global scopes; `ladder` when nothing is set for the role (D-018: ladder stays the default). */
export function resolveLandEscalationPolicy(
  scope: ScopedLandEscalationPolicy,
  role: string,
): LandEscalationPolicy {
  return (
    scope.run?.[role] ??
    scope.project?.[role] ??
    scope.global?.[role] ??
    LADDER_LAND_POLICY
  );
}

/**
 * W16-01: the rung a given REAL attempt runs at, under the resolved policy.
 *
 * This is the mapping that makes the ladder mean what BLUEPRINT §3.3 says —
 * cheapest first, then one rung up, then frontier — instead of "the same
 * model, three times". The loop stays model-agnostic exactly as the module
 * header demands: a rung is an attempt tier here, and WHAT runs at each tier
 * is the composing seam's business (`LandRungSessions`, wired in apps/server
 * where models are allowed to exist).
 *
 * `attempt` is the count of real attempts (infra-failure retries are free and
 * MUST NOT climb — FR-G3: escalation is evidence-triggered, and a crashed
 * sandbox is not evidence about the model).
 */
export function rungForAttempt(
  policy: LandEscalationPolicy,
  attempt: number,
): PolicyRung {
  if (policy.mode === 'locked') return policy.pinnedTier;
  if (attempt <= 1) return 'R1';
  if (attempt === 2) return 'R2';
  return 'R3';
}

const LAND_RUNG_ORDER: readonly PolicyRung[] = ['R1', 'R2', 'R3'];

export function isHigherRung(from: PolicyRung, to: PolicyRung): boolean {
  return LAND_RUNG_ORDER.indexOf(to) > LAND_RUNG_ORDER.indexOf(from);
}

/** Mirrors gateway's `FailureReceipt` (escalation/types.ts) — reproduced, not imported, per this module's header. */
export interface LandFailureReceipt {
  readonly name: string;
  readonly exitCode: number;
  readonly gapCount: number;
  readonly gaps?: readonly string[];
}

export interface LandRungAdvance {
  readonly ticketId: string;
  /** The real attempt about to run at `toRung`. */
  readonly attempt: number;
  readonly fromRung: PolicyRung;
  readonly toRung: PolicyRung;
  /** The composing seam's opaque label for what runs at `toRung` (a model name where the seam knows one). Ledger text, never routing. */
  readonly sessionLabel: string;
  /** Evidence from the attempt that failed at `fromRung` — never empty (FR-G3: evidence-triggered, never vibes-triggered). */
  readonly receipts: readonly LandFailureReceipt[];
}

/**
 * W16-01: the seam that lets attempts climb to a stronger session runner
 * WITHOUT this loop ever learning what a model is. Absent, every attempt
 * runs `options.spawn` — byte-identical to the pre-W16-01 loop, which is
 * also the honest shape for the external-agent runner (it owns its model)
 * and for a local-only/pinned user whose ladder has one real rung (FR-G5:
 * degrade honestly, never silently).
 */
export interface LandRungSessions {
  sessionForRung(rung: PolicyRung): {
    readonly spawn: SpawnSession;
    readonly label: string;
  };
  /** Fired BEFORE the first attempt that runs on a higher rung than the previous real attempt used. A hook failure never blocks the attempt (same posture as `AttemptOutcomeHook`). */
  onRungAdvance?(advance: LandRungAdvance): void | Promise<void>;
}

export interface LandEscalationTokenRequest {
  readonly ticketId: string;
  /** The named tier being climbed past. */
  readonly boundary: PolicyRung;
}

/** Minted only by an external approval action, never by this loop (NEVER-AUTO). */
export interface LandEscalationToken {
  readonly ticketId: string;
  readonly boundary: PolicyRung;
  readonly grantedBy: string;
  readonly grantedAt: string;
}

export interface LandEscalationTokenHook {
  checkToken(
    request: LandEscalationTokenRequest,
  ): LandEscalationToken | undefined | Promise<LandEscalationToken | undefined>;
}

/** Always honestly reports "no token" rather than fabricating one — same discipline as gateway's `noopEscalationTokenHook`. */
export const noopLandEscalationTokenHook: LandEscalationTokenHook = {
  checkToken() {
    return undefined;
  },
};

/** A BLUEPRINT §3.8/FR-N4 Decide card: decision-shaped, answerable in under a minute. */
export interface DecideCardOption {
  readonly label: string;
  readonly costSummary: string;
}

export interface DecideCard {
  readonly question: string;
  readonly context: string;
  readonly options: readonly DecideCardOption[];
  readonly recommendedDefault: string;
}

export function renderDecideCard(card: DecideCard): string {
  const optionLines = card.options.map((option) => {
    const marker = option.label === card.recommendedDefault ? ' (recommended)' : '';
    return `  - ${option.label}${marker} — cost: ${option.costSummary}`;
  });
  return [
    'DECIDE CARD (BLUEPRINT §3.8/FR-N4 — decision-shaped, answerable in under a minute):',
    `question: ${card.question}`,
    `context: ${card.context}`,
    'options:',
    ...optionLines,
  ].join('\n');
}

/** The Decide card raised when a token-gated ticket parks at its named tier boundary without an approval token. */
export function tokenBoundaryDecideCard(
  ticketId: string,
  ticketTitle: string,
  policy: TokenGatedLandPolicy,
): DecideCard {
  return {
    question: `Grant an escalation token so ${ticketId} can climb past ${policy.namedTier}?`,
    context:
      `${ticketId} (${ticketTitle}) failed its close gate at the ${policy.namedTier} ` +
      'boundary under the token-gated escalation policy (D-018) and cannot proceed ' +
      "without an approval-minted 'escalation' token.",
    options: [
      { label: 'grant token', costSummary: 'one more attempt at the next tier' },
      {
        label: 'leave parked',
        costSummary: 'no further spend; ticket stays blocked-with-evidence',
      },
    ],
    recommendedDefault: 'grant token',
  };
}
