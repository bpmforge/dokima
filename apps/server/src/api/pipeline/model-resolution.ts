/**
 * Resolves WHICH provider and WHICH model a pipeline call actually uses
 * (W10-03).
 *
 * Before this module the answer was three environment variables. The only
 * production model-call path in the product —`gateway-model-port.ts` and its
 * twin `onboard-dispatch-port.ts` — built a hardcoded `createOaiCompatProvider`
 * from `DOKIMA_MODEL_BASE_URL` / `DOKIMA_MODEL_API_KEY` / `DOKIMA_MODEL_ID`.
 * Neither call site imported the router, `resolveModelChain`, the role matrix
 * or the registry, so the Anthropic, OpenAI-native, Copilot and Vertex
 * adapters were never constructed on any production path — only by their own
 * tests. The matrix WAS read, but by `roster-resolve.ts`, for display only:
 * the UI could advertise a model the pipeline would never call.
 *
 * Resolution order, and the reason for it:
 *   1. An explicit registry + matrix selection — what the user actually chose.
 *   2. The environment variables — kept as a DOCUMENTED override for CI and
 *      fixtures (the e2e fake-model gateway relies on them), and deliberately
 *      LOSING to an explicit selection. A config that silently beats the UI is
 *      the bug this ticket exists to fix, in the other direction.
 *
 * Model->provider binding (W10-68): a matrix row's own `provider_id` column
 * is authoritative when set — the structured pair this ticket added so a
 * row states which provider it means instead of encoding it in punctuation.
 * A row without one predates this ticket (or was entered with no prefix at
 * all) and falls back to W10-60's `<providerId>/<model>` string convention
 * (`matrix-routes.ts` still flags Copilot rows by a `copilot/` prefix that
 * way). An unprefixed model resolves against the single enabled provider
 * when there is exactly one, and is otherwise ambiguous — reported, never
 * guessed.
 */

import {
  DEFAULT_ROLE,
  FitnessCardStore,
  route,
  type AgentRole,
  type ProviderEntry,
  type ProviderKind,
  type ScopedRoleMatrix,
  type TaskType,
} from '@dokima/gateway';
import { listProviders } from '../server/providers-store.js';
import { listModelMatrix } from '../server/model-matrix-store.js';
import type { ModelMatrixRow } from '../server/settings-types.js';

export class ModelResolutionError extends Error {
  constructor(
    message: string,
    public readonly rule: string,
  ) {
    super(message);
    this.name = 'ModelResolutionError';
  }
}

export interface ResolvedModelTarget {
  readonly providerId: string;
  readonly kind: ProviderKind;
  readonly baseUrl?: string;
  readonly credentialRef?: string;
  /** W10-57: the entry's own timeout, when it set one. Absent = the kind's default. */
  readonly requestTimeoutMs?: number;
  /** W13-10: extra request-body fields for this endpoint (e.g. `reasoning_effort`). */
  readonly requestExtras?: Record<string, unknown>;
  /** The bare model id sent on the wire — prefix stripped. */
  readonly model: string;
  /** GCP project/region for `vertex` (W12-14) — absent for every other kind. */
  readonly project?: string;
  readonly location?: string;
  /** How this was decided, so a run can explain itself. */
  readonly source: 'registry' | 'env';
}

/** Builds the routing matrix's project scope from the stored rows. */
export function matrixFromRows(rows: readonly ModelMatrixRow[]): ScopedRoleMatrix {
  const project: Record<string, { default: { model: string; fallbackChain: string[] } }> =
    {};
  for (const row of rows) {
    // The store is keyed (role, taskType); the router resolves per role with
    // optional per-task-type overrides. Rows for the same role collapse onto
    // the role default here, with task-type overrides layered on below.
    project[row.role] ??= {
      default: { model: row.model, fallbackChain: [...row.fallback] },
    };
  }
  const withTaskTypes: Record<string, unknown> = {};
  for (const [role, routing] of Object.entries(project)) {
    const taskTypes: Record<string, { model: string; fallbackChain: string[] }> = {};
    for (const row of rows.filter((r) => r.role === role)) {
      taskTypes[row.taskType] = { model: row.model, fallbackChain: [...row.fallback] };
    }
    withTaskTypes[role] = { ...routing, taskTypes };
  }
  return { project: withTaskTypes } as ScopedRoleMatrix;
}

/**
 * Splits `<providerId>/<model>` into its parts (W10-60).
 *
 * A first-slash split cannot tell a provider prefix from a vendor-namespaced
 * model id, and no care at the call site fixes that — the information simply
 * is not in the string. Of the 23 models a live LM Studio served this machine,
 * 8 carry a slash of their own (`qwen/…`, `google/…`, `nvidia/…`,
 * `mlx-community/…`), and every one of them used to resolve to a providerId
 * that does not exist: the W10-04 panel offered the model and the resolver
 * then refused it.
 *
 * THE FIX IS TO CONSULT THE REGISTRY, which is the only place the answer
 * lives. A prefix is a providerId only when it names a REGISTERED provider;
 * otherwise the whole value is the model id and goes on the wire intact.
 * `knownProviderIds` is therefore a required argument rather than an optional
 * convenience — the ambiguity is not resolvable without it, and a default
 * would just reintroduce the bug for whoever forgot to pass it.
 *
 * Recognition uses ALL registered ids, not just enabled ones. A matrix
 * pointing at `disabled-box/model` must still report an unusable provider,
 * not quietly reinterpret `disabled-box/model` as a model name and send it to
 * whichever provider happens to be the only enabled one.
 */
export function splitModelRef(
  value: string,
  knownProviderIds: readonly string[],
): {
  providerId?: string;
  model: string;
} {
  const slash = value.indexOf('/');
  if (slash <= 0) return { model: value };
  const prefix = value.slice(0, slash);
  if (!knownProviderIds.includes(prefix)) return { model: value };
  return { providerId: prefix, model: value.slice(slash + 1) };
}

/**
 * Looks up the providerId of the SPECIFIC row that produced a resolved
 * chain's primary model (W10-68) — the same (role, then role's own default)
 * selection `matrixFromRows`/`resolveModelChain` make internally, replayed
 * here because `route()` only hands back the flattened model string, not
 * the row it came from. `role` must already be the EFFECTIVE role
 * (`DEFAULT_ROLE` when `route()` reports `usedDefaultRole`), matching
 * whichever role's rows `matrixFromRows` actually used.
 */
/**
 * Overlays the pin onto the run scope. `fallbackChain: []` is the load-bearing
 * detail: `resolveModelChain` returns `[model, ...fallbackChain]`, so a pinned
 * chain has exactly one rung and there is nothing for an escalation to climb
 * to — the "never substitutes" half of the mode, enforced by the shape of the
 * data rather than by a check somewhere downstream.
 */
export function withPin(matrix: ScopedRoleMatrix, pin: PinnedModel | undefined): ScopedRoleMatrix {
  if (!pin) return matrix;
  return {
    ...matrix,
    run: { ...matrix.run, [pin.role]: { default: { model: pin.model, fallbackChain: [] } } },
  };
}

function pinUnhonoured(pin: PinnedModel, why: string): ModelResolutionError {
  return new ModelResolutionError(
    `the pinned model "${pin.model}" for role "${pin.role}" cannot be used: ${why}. ` +
      `Refusing rather than running a different model — pinning means nothing ` +
      `else runs. Configure that provider, or choose another model policy.`,
    'pinned-model-unavailable',
  );
}

function findRowProviderId(
  rows: readonly ModelMatrixRow[],
  role: AgentRole,
  taskType: TaskType,
): string | undefined {
  const roleRows = rows.filter((r) => r.role === role);
  const exact = roleRows.find((r) => r.taskType === taskType);
  return (exact ?? roleRows[0])?.providerId;
}

interface BoundModel {
  readonly modelRef: string;
  /** The row's OWN provider binding (W10-68), when it has one. */
  readonly providerId?: string;
}

/**
 * Binds a resolved model string to a provider.
 *
 * `providerId` set (a structured row, or a migrated legacy one) is the
 * whole answer: no string parsing, no ambiguity, and an id naming no
 * ENABLED provider refuses with `unknown-provider` — RESTORING the refusal
 * W10-60 had to trade away (see `splitModelRef`'s docstring). `providerId`
 * absent means the row predates this ticket and was never migrated (its
 * `model` may still encode "<providerId>/<model>"): fall back to W10-60's
 * registry-consulting split, the bounded, DOCUMENTED regression this
 * ticket does not remove — see "binds an unregistered prefix..." in
 * model-resolution.test.ts.
 */
function bindProvider(
  bound: BoundModel,
  providers: readonly ProviderEntry[],
): ResolvedModelTarget {
  const enabled = providers.filter((p) => p.enabled);

  if (bound.providerId !== undefined) {
    const match = enabled.find((p) => p.id === bound.providerId);
    if (!match) {
      throw new ModelResolutionError(
        `the matrix routes to "${bound.modelRef}" but no ENABLED provider is registered with id "${bound.providerId}"`,
        'unknown-provider',
      );
    }
    return { ...toTarget(match), model: bound.modelRef, source: 'registry' };
  }

  const { providerId, model } = splitModelRef(
    bound.modelRef,
    providers.map((p) => p.id),
  );

  if (providerId !== undefined) {
    const match = enabled.find((p) => p.id === providerId);
    if (!match) {
      throw new ModelResolutionError(
        `the matrix routes to "${bound.modelRef}" but no ENABLED provider is registered with id "${providerId}"`,
        'unknown-provider',
      );
    }
    return { ...toTarget(match), model, source: 'registry' };
  }

  if (enabled.length === 1) {
    return { ...toTarget(enabled[0]!), model, source: 'registry' };
  }
  throw new ModelResolutionError(
    enabled.length === 0
      ? `the matrix routes to "${bound.modelRef}" but no provider is enabled`
      : `"${bound.modelRef}" has no provider prefix and ${enabled.length} providers are enabled — qualify it as "<providerId>/${bound.modelRef}"`,
    enabled.length === 0 ? 'no-enabled-provider' : 'ambiguous-provider',
  );
}

function toTarget(entry: ProviderEntry): Omit<ResolvedModelTarget, 'model' | 'source'> {
  return {
    providerId: entry.id,
    kind: entry.kind,
    ...(entry.baseUrl === undefined ? {} : { baseUrl: entry.baseUrl }),
    ...(entry.credentialRef === undefined ? {} : { credentialRef: entry.credentialRef }),
    ...(entry.project === undefined ? {} : { project: entry.project }),
    ...(entry.location === undefined ? {} : { location: entry.location }),
    ...(entry.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: entry.requestTimeoutMs }),
    ...(entry.requestExtras === undefined ? {} : { requestExtras: entry.requestExtras }),
  };
}

/** The env fallback — unchanged behaviour, now explicitly second in line. */
export function envTarget(env: NodeJS.ProcessEnv = process.env): ResolvedModelTarget {
  return {
    providerId: 'env',
    kind: 'oai-compat',
    baseUrl: env.DOKIMA_MODEL_BASE_URL ?? 'http://127.0.0.1:1234/v1',
    model: env.DOKIMA_MODEL_ID ?? 'local-model',
    source: 'env',
  };
}

export interface ResolveModelTargetInput {
  /** Absent (no project in view) means env-only resolution. */
  readonly projectPath?: string;
  readonly role: AgentRole;
  readonly taskType: TaskType;
  readonly actorId?: string;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * D-024 option (b) / D-027: run EXACTLY this model for this role.
   *
   * Expressed as a RUN-SCOPED matrix entry rather than an override beside the
   * matrix, so it goes THROUGH `route()` and inherits three things instead of
   * re-deriving them: FR-S1's run > project > global precedence (a pin needs
   * no new ordering rule to beat the project row), `guardMakerVerifierDistinct`
   * (the verifier resolves the maker from this same matrix, so a pin cannot
   * silently collapse C-4), and the fitness guard (a model unfit for the role
   * still needs its ack). `ScopedRoleMatrix.run` has existed unused since
   * W2-05 — `matrixFromRows` builds `{ project }` only — and this is the first
   * thing that needed it.
   */
  readonly pin?: PinnedModel;
  /** Test seams — real callers use the stores. */
  readonly loadProviders?: (projectPath: string) => Promise<ProviderEntry[]>;
  readonly loadMatrixRows?: (projectPath: string) => Promise<ModelMatrixRow[]>;
}

export interface PinnedModel {
  readonly role: AgentRole;
  /** `<providerId>/<model>` or a bare model id, same shape the matrix rows use. */
  readonly model: string;
  /** Explicit binding; otherwise taken from the model ref, then the role's row. */
  readonly providerId?: string;
}

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
  const { projectPath, pin } = input;
  if (projectPath === undefined) {
    if (pin) throw pinUnhonoured(pin, 'no project is in view, so no provider registry to bind it to');
    return envTarget(input.env);
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
    return envTarget(input.env);
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

  try {
    return bindProvider({ modelRef: routed.chain[0]!, providerId }, providers);
  } catch (err) {
    // Same reason as the short-circuits above: an unbindable pin is a refusal
    // that names the pin, not a generic binding error the caller has to guess
    // the cause of.
    if (pinApplies) throw pinUnhonoured(pin, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
