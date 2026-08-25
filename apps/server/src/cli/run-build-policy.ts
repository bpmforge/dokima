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

/** How many tool turns one session may take before the cap stops it (W13-11). */
export const MAX_TOOL_ITERATIONS_SETTINGS_KEY = 'maxToolIterations';

/**
 * The most a session may be given, however it is configured.
 *
 * A setting that accepts any number re-opens T-27 ("a session iterates tool
 * calls indefinitely without producing a manifest") by configuration, which is
 * the failure the cap exists to prevent. 40 is roughly three times the default
 * and comfortably past what a chatty local model needed in testing, while
 * still bounding a runaway session's spend.
 */
export const MAX_TOOL_ITERATIONS_CEILING = 40;

/** How many tokens one model turn may emit before the ceiling stops it (W13-43). */
export const MAX_TURN_TOKENS_SETTINGS_KEY = 'maxTurnTokens';

/**
 * The most one turn may be given, however it is configured.
 *
 * Same reasoning as the iteration ceiling above, against a different runaway:
 * a setting that accepts any number re-opens "a session generates forever"
 * (T-27) by configuration. 128k is four times the default and past any turn a
 * real model has produced on this board — the largest measured legitimate turn
 * was 6,646 tokens.
 */
export const MAX_TURN_TOKENS_CEILING = 128_000;

/** Wall-clock ceiling on one agent session, both runners (W13-47). */
export const MAX_SESSION_SECONDS_SETTINGS_KEY = 'maxSessionSeconds';

/**
 * The most one session may be given, however it is configured.
 *
 * Four hours. Deliberately far above the ceiling's own default: this is the
 * last backstop in the stack, and someone on genuinely slow hardware may need
 * real room. What it refuses is a value that means "never" — which is the
 * state the product was in before W13-44, and the one a session that runs
 * forever depends on.
 */
export const MAX_SESSION_SECONDS_CEILING = 4 * 60 * 60;

/**
 * The tool-turn cap the user chose (W13-11).
 *
 * Found in live testing: with thinking disabled, a local 27b produced CORRECT
 * work and still parked, because it used all twelve turns before emitting a
 * manifest. `maxIterations` was a session option NOTHING in apps/server set,
 * so `DEFAULT_MAX_TOOL_ITERATIONS = 12` was the value every model got.
 *
 * The default does not move: 12 is right for a capable model — the qwen run
 * landed in four calls — and raising it for everyone would spend other
 * people's budget to accommodate one weak one. This is a knob for whoever
 * chose a chatty local model, which is D-024 option (a) territory.
 *
 * REFUSES rather than clamps. Silently running a different number than the one
 * configured is the defect class this board keeps finding.
 */
export function resolveMaxToolIterations(
  raw: JsonValue | undefined,
): { readonly maxIterations?: number } | { readonly refusal: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    return {
      refusal:
        `${MAX_TOOL_ITERATIONS_SETTINGS_KEY} must be a whole number of tool turns ` +
        `(at least 1); got ${JSON.stringify(raw)}.`,
    };
  }
  if (raw > MAX_TOOL_ITERATIONS_CEILING) {
    return {
      refusal:
        `${MAX_TOOL_ITERATIONS_SETTINGS_KEY} is ${raw}, over the ceiling of ` +
        `${MAX_TOOL_ITERATIONS_CEILING}. The cap exists so a session cannot ` +
        `iterate forever without producing a manifest (T-27); a setting that ` +
        `accepts any value would re-open that by configuration. Lower it, or ` +
        `use a model that finishes.`,
    };
  }
  return { maxIterations: raw };
}

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
/**
 * The routing half of a pinned policy (D-027), for `resolveModelTarget`'s
 * `pin`. Returns undefined for every other mode, so a caller can pass this
 * unconditionally.
 */
export function resolvePinnedModel(
  raw: JsonValue | undefined,
  role: string,
): { readonly role: string; readonly model: string; readonly providerId?: string } | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (value.mode !== 'pinned') return undefined;
  if (typeof value.model !== 'string' || value.model === '') return undefined;
  return {
    role,
    model: value.model,
    ...(typeof value.providerId === 'string' ? { providerId: value.providerId } : {}),
  };
}

/**
 * FR-L7's ceiling depends on whether the tier costs money per token: 8 attempts
 * on metered, 12 on owned hardware. A model string cannot tell you which, so
 * D-027 infers it from the PROVIDER kind the user already chose rather than
 * asking a fifth wizard question to set a retry ceiling. Unknown or absent
 * reads as metered, which is the conservative direction: over-spending
 * someone's money is the failure that matters here.
 */
export function tierKindFor(providerKind: unknown): 'local' | 'metered' {
  return providerKind === 'lm-studio' || providerKind === 'ollama' ? 'local' : 'metered';
}

export function resolvePolicyScope(
  raw: JsonValue | undefined,
  role: string,
): { readonly scope: ScopedLandEscalationPolicy } | { readonly refusal: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { scope: {} };
  const value = raw as Record<string, unknown>;
  const mode = value.mode;

  if (mode === 'ask') {
    // D-029: never climb unattended. `locked` is exactly "retry the same rung
    // under the ceiling, then park" — so the attempt in flight is unaffected
    // and nothing escalates until the founder answers. Approving writes this
    // member's mode to `ladder`, which is a visible, inspectable settings
    // change rather than hidden approval state.
    return {
      scope: {
        global: {
          [role]: {
            mode: 'locked',
            pinnedTier: 'R1',
            tierKind: tierKindFor(value.providerKind),
          } as LandEscalationPolicy,
        },
      },
    };
  }

  if (mode === 'pinned') {
    // D-027: a pin is TWO facts in two layers, and this function only owns the
    // second. WHICH MODEL is a routing fact (`resolvePinnedModel` below, fed to
    // `resolveModelTarget` as a run-scoped matrix entry); HOW MANY RETRIES
    // BEFORE PARKING is this layer's, and `locked` already means exactly that
    // — retry the same thing under the convergence ceiling, park, never
    // escalate. Nothing new is added to the land policy union, which is what
    // keeps the loop model-agnostic: it still never learns what a model is.
    const model = value.model;
    if (typeof model !== 'string' || model === '') {
      return {
        refusal:
          `the stored escalation policy pins a model but names none. Refusing ` +
          `rather than falling back to the ladder — a pin that resolves to ` +
          `"whatever was next" is the silent substitution the mode exists to ` +
          `prevent. Re-pick the model, or choose another policy.`,
      };
    }
    return {
      scope: {
        global: {
          [role]: {
            mode: 'locked',
            // The land loop's rungs are attempt counts, not models, so the
            // pinned "tier" is R1: the first and only attempt tier there is.
            pinnedTier: 'R1',
            tierKind: tierKindFor(value.providerKind),
          } as LandEscalationPolicy,
        },
      },
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


/**
 * The per-turn output ceiling the user chose (W13-43).
 *
 * Found by running the product: a local model entered a generation loop and
 * streamed for as long as the run was left going. `lsof` showed a live
 * connection, LM Studio 160% CPU, our process 0.7%. No guard fired, and that
 * was by design — W13-15 replaced duration bounds with an idle bound, which
 * cannot see a model that never goes idle.
 *
 * The default does not move. It is sized off measured turns (median 60, p95
 * 438, largest legitimate 6,646), so honest work never meets it; this is a
 * knob for someone whose work genuinely produces enormous single turns.
 *
 * REFUSES rather than clamps, exactly like `resolveMaxToolIterations`:
 * silently running a different number than the one configured is the defect
 * class this board keeps finding.
 */
export function resolveMaxTurnTokens(
  raw: JsonValue | undefined,
): { readonly maxTurnTokens?: number } | { readonly refusal: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    return {
      refusal:
        `${MAX_TURN_TOKENS_SETTINGS_KEY} must be a whole number of tokens ` +
        `(at least 1); got ${JSON.stringify(raw)}.`,
    };
  }
  if (raw > MAX_TURN_TOKENS_CEILING) {
    return {
      refusal:
        `${MAX_TURN_TOKENS_SETTINGS_KEY} is ${raw}, over the ceiling of ` +
        `${MAX_TURN_TOKENS_CEILING}. The cap exists so one turn cannot generate ` +
        `forever (T-27); a setting that accepts any value would re-open that by ` +
        `configuration. Lower it, or use a model that stops.`,
    };
  }
  return { maxTurnTokens: raw };
}

/**
 * The per-session wall-clock ceiling the user chose (W13-47).
 *
 * ONE setting for both runners. W13-44 wired the bound into the built-in
 * agent with a hardcoded default and left the external-CLI runner with no
 * bound at all; two separate ceilings that could disagree would be worse than
 * one that is occasionally wrong.
 *
 * The default (`DEFAULT_MAX_SESSION_SECONDS`, 30 minutes) does not move — it
 * is sized off measured sessions of roughly three minutes, and the ladder
 * multiplies it by attempt count. This is a knob for slow hardware.
 *
 * REFUSES rather than clamps, like every other limit on this path.
 */
export function resolveMaxSessionSeconds(
  raw: JsonValue | undefined,
): { readonly maxSessionSeconds?: number } | { readonly refusal: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    return {
      refusal:
        `${MAX_SESSION_SECONDS_SETTINGS_KEY} must be a whole number of seconds ` +
        `(at least 1); got ${JSON.stringify(raw)}. Use a large number for a long ` +
        `leash — there is no value meaning "never give up".`,
    };
  }
  if (raw > MAX_SESSION_SECONDS_CEILING) {
    return {
      refusal:
        `${MAX_SESSION_SECONDS_SETTINGS_KEY} is ${raw}, over the ceiling of ` +
        `${MAX_SESSION_SECONDS_CEILING}. A session with no effective time bound is ` +
        `the state that made runs hang with nothing to explain them. Lower it.`,
    };
  }
  return { maxSessionSeconds: raw };
}

/** Every numeric bound one run enforces, resolved together (W13-47). */
export interface RunLimits {
  readonly maxIterations?: number;
  readonly maxTurnTokens?: number;
  readonly maxSessionSeconds: number;
}

/**
 * Resolves the run's three limits from settings, or refuses (W13-47).
 *
 * Collected into one call because three near-identical read-check-refuse
 * blocks in `executeBuildRun` were three chances for the next one to be
 * written slightly differently — and because a fourth limit is likelier than
 * not, given this phase added three. Each individual resolver still refuses
 * rather than clamps on its own terms; this only decides the order and returns
 * the first refusal.
 *
 * `maxSessionSeconds` resolves to a NUMBER rather than staying optional: both
 * runners need one, and a default applied in two places is a default that can
 * disagree with itself.
 */
export function resolveRunLimits(
  read: (key: string) => JsonValue | undefined,
  defaultSessionSeconds: number,
): { readonly limits: RunLimits } | { readonly refusal: string } {
  const iterations = resolveMaxToolIterations(read(MAX_TOOL_ITERATIONS_SETTINGS_KEY));
  if ('refusal' in iterations) return iterations;

  const turnTokens = resolveMaxTurnTokens(read(MAX_TURN_TOKENS_SETTINGS_KEY));
  if ('refusal' in turnTokens) return turnTokens;

  const sessionSeconds = resolveMaxSessionSeconds(read(MAX_SESSION_SECONDS_SETTINGS_KEY));
  if ('refusal' in sessionSeconds) return sessionSeconds;

  return {
    limits: {
      ...iterations,
      ...turnTokens,
      maxSessionSeconds: sessionSeconds.maxSessionSeconds ?? defaultSessionSeconds,
    },
  };
}
