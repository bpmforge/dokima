/**
 * model-resolution-chain.ts — THE SEAM's resolvers (W16-01).
 *
 * Chapter of `model-resolution.ts`, split under the 400-line
 * CODE_BOOK_PROTOCOL cap when the chain resolver pushed that file to 456.
 * The seam is real: `model-resolution.ts` owns the vocabulary (target and
 * input types, matrix building, provider binding, refusals); this chapter
 * owns the two functions that USE it to answer "which model(s) will a call
 * actually run". `model-resolution.ts` re-exports both, so every existing
 * importer keeps its one import path.
 */
import { DEFAULT_ROLE, FitnessCardStore, route } from '@dokima/gateway';
import { listProviders } from '../server/providers-store.js';
import { listModelMatrix } from '../server/model-matrix-store.js';
import {
  bindProvider,
  envNamesAModel,
  envTarget,
  findRowProviderId,
  matrixFromRows,
  noModelConfigured,
  pinUnhonoured,
  withPin,
  type ResolvedModelTarget,
  type ResolveModelTargetInput,
} from './model-resolution.js';

/**
 * THE SEAM. Returns the provider+model a call will actually use.
 *
 * `route()` (not a bare `resolveModelChain`) is used deliberately: it makes
 * the maker != verifier guard STRUCTURAL (C-4 / Law 5) — routing a verifier
 * role auto-resolves the maker role for the same task type and refuses a
 * collision — so wiring the registry in cannot become a way to bypass it.
 */
export async function resolveModelTarget(
  input: ResolveModelTargetInput,
): Promise<ResolvedModelTarget> {
  // W16-01: delegates to the chain resolver so the two can never drift —
  // entry 0 of the chain IS this function's historical answer, bound the
  // same way, refusing the same ways.
  return (await resolveModelTargetChain(input)).targets[0]!;
}

/** W16-01: one bound target per ladder rung, plus what could NOT bind (reported, never silently dropped). */
export interface ResolvedModelChain {
  /** Cheapest first — entry 0 is exactly what `resolveModelTarget` returns; entries 1+ come from the winning row's `fallback` chain (FR-G3's climb order). */
  readonly targets: readonly ResolvedModelTarget[];
  /** Fallback entries that could not bind to an ENABLED provider. The ladder simply has fewer real rungs then — the caller says so, honestly (FR-G5). */
  readonly unbindable: readonly { readonly modelRef: string; readonly reason: string }[];
}

/**
 * W16-01: the whole chain `route()` resolves, bound — not just `chain[0]`.
 *
 * `route()` has always returned `[model, ...fallbackChain]`; `resolveModelTarget`
 * takes the head and discards the rest, which is precisely where the BLUEPRINT
 * §3.3 ladder died: the fallback models the user configured in the matrix were
 * stored, rendered in Settings, and never run. Entry 0 binds exactly as before
 * (row/pin provider binding, same refusals). Later entries bind by their own
 * ref (`<providerId>/<model>` or a bare id against a single enabled provider) —
 * NOT by the winning row's binding, because a fallback usually lives on a
 * different provider than the cheap primary. One that cannot bind is returned
 * in `unbindable` rather than thrown: a half-configured fallback should shorten
 * the ladder honestly, not take down the run that never needed it.
 */
export async function resolveModelTargetChain(
  input: ResolveModelTargetInput,
): Promise<ResolvedModelChain> {
  const { projectPath, pin } = input;
  if (projectPath === undefined) {
    if (pin)
      throw pinUnhonoured(
        pin,
        'no project is in view, so no provider registry to bind it to',
      );
    if (!envNamesAModel(input.env)) throw noModelConfigured();
    return { targets: [envTarget(input.env)], unbindable: [] };
  }

  const loadProviders = input.loadProviders ?? listProviders;
  const loadMatrixRows = input.loadMatrixRows ?? listModelMatrix;

  const [providers, rows] = await Promise.all([
    loadProviders(projectPath),
    loadMatrixRows(projectPath),
  ]);

  // Nothing configured is a normal first-run state, not an error (C-1) — but
  // NOT when a model was pinned. Falling through to the env default here would
  // serve a different model than the one the user named, silently, which is
  // the substitution the whole mode exists to prevent.
  if (rows.length === 0 || providers.length === 0) {
    if (pin) throw pinUnhonoured(pin, 'no providers or matrix rows are configured');
    // W13-34: the env seam still wins when it is explicitly set. What changed
    // is the empty case: it used to return a placeholder target and fail at the
    // endpoint, and now it says what is missing and where to fix it.
    if (!envNamesAModel(input.env)) throw noModelConfigured();
    return { targets: [envTarget(input.env)], unbindable: [] };
  }

  const routed = await route({
    matrix: withPin(matrixFromRows(rows), pin),
    role: input.role,
    taskType: input.taskType,
    actorId: input.actorId ?? 'pipeline',
    fitnessStore: new FitnessCardStore(),
  });

  // The row that WON is not necessarily keyed by `input.role`: `route()`
  // falls back to the `DEFAULT_ROLE` role's rows when `input.role` has none
  // of its own (`usedDefaultRole`), and `matrixFromRows` did the same thing
  // building the matrix `route()` read. Looking the provider up under the
  // wrong role would silently find a different row's binding, or none.
  const effectiveRole = routed.usedDefaultRole ? DEFAULT_ROLE : input.role;
  const pinApplies = pin !== undefined && pin.role === input.role;
  // A pinned role has no row, so `findRowProviderId` would hand back the
  // binding of whatever row the project happens to hold for it — a different
  // provider than the one pinned. The pin carries its own binding.
  const providerId = pinApplies
    ? pin.providerId
    : findRowProviderId(rows, effectiveRole, input.taskType);

  let head: ResolvedModelTarget;
  try {
    head = bindProvider({ modelRef: routed.chain[0]!, providerId }, providers);
  } catch (err) {
    // Same reason as the short-circuits above: an unbindable pin is a refusal
    // that names the pin, not a generic binding error the caller has to guess
    // the cause of.
    if (pinApplies)
      throw pinUnhonoured(pin, err instanceof Error ? err.message : String(err));
    throw err;
  }

  const targets: ResolvedModelTarget[] = [head];
  const unbindable: { modelRef: string; reason: string }[] = [];
  for (const modelRef of routed.chain.slice(1)) {
    try {
      targets.push(bindProvider({ modelRef }, providers));
    } catch (err) {
      unbindable.push({
        modelRef,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { targets, unbindable };
}
