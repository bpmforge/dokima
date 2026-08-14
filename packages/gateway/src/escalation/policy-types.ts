/**
 * Escalation policy mode types (D-018, BLUEPRINT §3.3): a three-scope
 * (run > project > global), per-role setting choosing HOW a ticket climbs
 * ladder.ts's R0-R4 sequence — `ladder` (default, unchanged R0-R4 climb),
 * `locked` (pinned tier, retries in place under FR-L7's tier-aware
 * convergence ceiling, then parks — never climbs, never escalates), or
 * `token-gated` (climbs normally up to a named tier, then requires an
 * approval-minted token — FR-N2's `escalation` risk class — before
 * crossing it).
 */

import type { ThreeScopeMap } from '../routing/types.js';
import type { Rung } from './types.js';

export type EscalationPolicyMode = 'ladder' | 'locked' | 'token-gated' | 'pinned';

/** The tiers a policy can meaningfully pin or gate on — R0 is free (memory) and R4 is already ladder.ts's terminal park, so neither is a pinnable/gateable rung. */
export type PolicyRung = Extract<Rung, 'R1' | 'R2' | 'R3'>;

export interface LadderPolicy {
  readonly mode: 'ladder';
}

export const LADDER_POLICY: LadderPolicy = { mode: 'ladder' };

/**
 * FR-L7's tier-aware convergence ceiling: capped 8 on frontier/metered
 * tiers, 12 on local/owned-hardware tiers (the wall-clock watchdog is the
 * backstop on local tiers — out of this ticket's scope). This package has
 * no way to know a model's deployment/hardware profile on its own (no
 * workspace dependency declared for this ticket's write_scope), so the
 * caller declares which kind the pinned tier's model is — the same
 * injection-point discipline budget/types.ts's `BudgetLimits` uses for
 * caller-supplied ceilings rather than derived ones.
 */
export type TierKind = 'metered' | 'local';

export const CONVERGENCE_CEILING: Readonly<Record<TierKind, number>> = {
  metered: 8,
  local: 12,
};

export interface LockedPolicy {
  readonly mode: 'locked';
  readonly pinnedTier: PolicyRung;
  readonly tierKind: TierKind;
}

export interface TokenGatedPolicy {
  readonly mode: 'token-gated';
  /** Climbing past this tier requires a minted escalation token. */
  readonly namedTier: PolicyRung;
}

/**
 * `pinned` (D-024 option b, W12-12): run EXACTLY this model and nothing else.
 *
 * NOT the same promise as `locked`, which is why it is a separate mode rather
 * than a widening of it. `locked` pins a ladder RUNG and resolves the model
 * through the matrix at attempt time — so the model it runs can change as the
 * matrix changes underneath the user. A user who says "use gpt-5 and nothing
 * else" is choosing a MODEL, and a rung cannot express that. Both modes retry
 * in place under the same FR-L7 convergence ceiling and both park rather than
 * climb; the difference is entirely about what is being held fixed.
 */
export interface PinnedModelPolicy {
  readonly mode: 'pinned';
  /** The exact model id. Never resolved through the matrix — that is the point. */
  readonly model: string;
  /**
   * Which registered provider serves it. A bare model id is ambiguous once
   * the same name is reachable through more than one provider (an
   * oai-compat endpoint and a first-party adapter, say), and silently
   * picking one would be the substitution this mode exists to prevent.
   */
  readonly providerId?: string;
  /** Selects the FR-L7 convergence ceiling, exactly as `locked` does. */
  readonly tierKind: TierKind;
}

export type EscalationPolicy =
  | LadderPolicy
  | LockedPolicy
  | TokenGatedPolicy
  | PinnedModelPolicy;

/**
 * C-4 is mechanical: reviewer identities and MODELS are distinct by
 * construction, and a convenience setting does not get to dissolve a hard
 * constraint. Pinning one model for every role would make maker and verifier
 * the same model — so that configuration is refused BY NAME rather than
 * quietly permitted, which is the trap this mode would otherwise walk into.
 */
export class PinnedPolicyMakerVerifierError extends Error {
  constructor(
    readonly model: string,
    readonly makerRole: string,
    readonly verifierRole: string,
  ) {
    super(
      `escalation policy pins model "${model}" for BOTH the maker role ` +
        `"${makerRole}" and the verifier role "${verifierRole}". C-4 requires ` +
        `maker and verifier to differ by construction, so this configuration is ` +
        `refused rather than run: pin a different model for "${verifierRole}", or ` +
        `leave that role on the ladder.`,
    );
    this.name = 'PinnedPolicyMakerVerifierError';
  }
}

/** Three-scope map of policy by role (run > project > global, FR-S1) — same shape routing/types.ts's `ScopedRoleMatrix` uses for the model matrix, reused generically rather than reproduced. */
export type ScopedEscalationPolicy = ThreeScopeMap<EscalationPolicy>;

/** FR-N2: approval cards are risk-classed; this module only ever raises 'escalation'. */
export type EscalationApprovalRiskClass = 'escalation';

export interface EscalationTokenRequest {
  readonly ticketId: string;
  /** The named tier being climbed past. */
  readonly boundary: PolicyRung;
}

/** Minted only by an external approval action, never by this engine (NEVER-AUTO: nothing in this directory can produce one of these itself). */
export interface EscalationToken {
  readonly riskClass: EscalationApprovalRiskClass;
  readonly ticketId: string;
  readonly boundary: PolicyRung;
  readonly grantedBy: string;
  readonly grantedAt: string;
}

export interface EscalationTokenHook {
  checkToken(
    request: EscalationTokenRequest,
  ): EscalationToken | undefined | Promise<EscalationToken | undefined>;
}

/** Real wiring to an approvals flow lands in a future ticket; until then, always honestly reports "no token" rather than fabricating one — same discipline as memory-hook.ts's noop default. */
export const noopEscalationTokenHook: EscalationTokenHook = {
  checkToken() {
    return undefined;
  },
};
