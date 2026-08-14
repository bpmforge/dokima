/**
 * cli/run-build-policy.ts — reading the escalation policy the user chose.
 *
 * Chapter of run-build.ts, split under the 400-line CODE_BOOK_PROTOCOL cap the
 * moment adding this pushed that file to 468 lines. Second time this session
 * the cap has caught accretion rather than a single oversized write, which is
 * the case it exists for: the cap is on the FILE, not the diff.
 */
import type { JsonValue } from '@dokima/shared';
import type {
  LandEscalationPolicy,
  ScopedLandEscalationPolicy,
} from '@dokima/harbormaster';

/** The generic settings key both the Settings panel and the first-run wizard write. */
export const ESCALATION_POLICY_SETTINGS_KEY = 'escalationPolicy';

/**
 * The escalation policy the user actually chose, as a scope `runLandLoop` can
 * resolve (W12-18).
 *
 * THIS DID NOT EXIST, and its absence made D-024 inert. Two UI surfaces have
 * been persisting `escalationPolicy` — the Settings panel since W10, the
 * first-run wizard since W12-13 — and NOTHING read it: `run-build.ts` never
 * passed `policyScope`, so `loop-land.ts` resolved `options.policyScope ?? {}`
 * and every run took `LADDER_LAND_POLICY` no matter what was stored. A user
 * who chose "escalate only when I approve it" got unattended escalation.
 *
 * APPLIED TO THE MAKER ROLE ONLY. The stored setting is a single flat object
 * while the scope is keyed by role, so something has to decide the mapping.
 * Pinning it to the maker makes the setting mean what the user thinks it
 * means, and leaves verifiers on the ladder — which keeps maker != verifier
 * (C-4) true BY CONSTRUCTION rather than by a refusal discovered at run time.
 */
export function resolvePolicyScope(
  raw: JsonValue | undefined,
  role: string,
): { readonly scope: ScopedLandEscalationPolicy } | { readonly refusal: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { scope: {} };
  const value = raw as Record<string, unknown>;
  const mode = value.mode;

  if (mode === 'pinned') {
    // W12-12 added `pinned` to the GATEWAY policy union; harbormaster's
    // `LandEscalationPolicy` is a separate union that does not model it.
    // Falling through to `ladder` would be exactly the silent substitution
    // pinning exists to prevent, so this refuses and says so.
    return {
      refusal:
        `the stored escalation policy pins a single model, which the land loop ` +
        `does not yet honour (its policy union covers ladder/locked/token-gated). ` +
        `Refusing rather than silently running the ladder instead — the whole ` +
        `point of pinning is that nothing else quietly runs. Choose another ` +
        `policy, or clear the setting to take the ladder deliberately.`,
    };
  }

  if (mode === 'locked') {
    const pinnedTier = value.pinnedTier;
    const tierKind = value.tierKind;
    if (typeof pinnedTier !== 'string' || typeof tierKind !== 'string') return { scope: {} };
    return {
      scope: {
        global: {
          [role]: {
            mode: 'locked',
            pinnedTier,
            tierKind,
          } as LandEscalationPolicy,
        },
      },
    };
  }

  if (mode === 'token-gated') {
    const namedTier = value.namedTier;
    if (typeof namedTier !== 'string') return { scope: {} };
    return {
      scope: {
        global: {
          [role]: { mode: 'token-gated', namedTier } as LandEscalationPolicy,
        },
      },
    };
  }

  // `ladder`, absent, or an unreadable shape: the documented default, and the
  // same "an unreadable setting cannot take the surface down" posture
  // `parseAgentRunnerSetting` already uses.
  return { scope: {} };
}

