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

import type {
  AgentRole,
  ProviderEntry,
  ProviderKind,
  ScopedRoleMatrix,
  TaskType,
} from '@dokima/gateway';
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
export function withPin(
  matrix: ScopedRoleMatrix,
  pin: PinnedModel | undefined,
): ScopedRoleMatrix {
  if (!pin) return matrix;
  return {
    ...matrix,
    run: {
      ...matrix.run,
      [pin.role]: { default: { model: pin.model, fallbackChain: [] } },
    },
  };
}

export function pinUnhonoured(pin: PinnedModel, why: string): ModelResolutionError {
  return new ModelResolutionError(
    `the pinned model "${pin.model}" for role "${pin.role}" cannot be used: ${why}. ` +
      `Refusing rather than running a different model — pinning means nothing ` +
      `else runs. Configure that provider, or choose another model policy.`,
    'pinned-model-unavailable',
  );
}

export function findRowProviderId(
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
export function bindProvider(
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

/**
 * True when the environment EXPLICITLY names a model endpoint (W13-34): an
 * operator who set these is telling Dokima where to go (the law 9a CI seam);
 * an empty environment is telling it nothing, and guessing there is what made
 * a clean install fail.
 */
export function envNamesAModel(env: NodeJS.ProcessEnv = process.env): boolean {
  // W13-36: the MODEL ID is what counts — a base URL names an ENDPOINT, and an
  // endpoint plus a guessed id is what produced "Invalid model identifier".
  return Boolean(env.DOKIMA_MODEL_ID);
}

/**
 * Nothing anywhere says which model to use (W13-34). A fresh install used to
 * fail here with `env: request failed with 400 Bad Request (HTTP 500)` — a
 * placeholder id at a guessed endpoint, with the endpoint's own clear answer
 * discarded. Law 9(b): the model is the user's choice, never defaulted.
 */
export function noModelConfigured(): ModelResolutionError {
  return new ModelResolutionError(
    'no model is configured for this project yet. Open Settings → Models to ' +
      'choose one, or register a provider first — Dokima will not guess an ' +
      'endpoint on your behalf.',
    'no-model-configured',
  );
}

/** The env fallback — unchanged behaviour, now explicitly second in line. */
export function envTarget(env: NodeJS.ProcessEnv = process.env): ResolvedModelTarget {
  return {
    providerId: 'env',
    kind: 'oai-compat',
    baseUrl: env.DOKIMA_MODEL_BASE_URL ?? 'http://127.0.0.1:1234/v1',
    // Never guessed: `envNamesAModel` gates every path here (W13-36).
    model: env.DOKIMA_MODEL_ID ?? '',
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
 * THE SEAM's resolvers live in the `model-resolution-chain.ts` chapter
 * (CODE_BOOK_PROTOCOL split, W16-01) — re-exported here so every existing
 * importer keeps this file as the one import path.
 */
export {
  resolveModelTarget,
  resolveModelTargetChain,
  type ResolvedModelChain,
} from './model-resolution-chain.js';

/**
 * W17-05: the model answers before the button does. One cheap, bounded
 * question to the provider BEFORE any run state is minted — an unreachable
 * endpoint refuses at the click with the model and the fix location named,
 * never a mid-run surprise minutes later. `listed` is advisory only: the
 * 2026-08-21 live UAT proved LM Studio JIT-loads models its /models list
 * does not show, so an unlisted id WARNS and proceeds (refusing it would
 * break a working setup), while unreachable refuses hard.
 */
export interface ModelPreflightResult {
  readonly ok: boolean;
  /** ok=true only: whether the provider's model list names the id (false = warn, not refuse). */
  readonly listed?: boolean;
  readonly reason?: string;
}

export async function preflightModelReachability(
  provider: {
    health(): Promise<{ status: string; detail?: string }>;
    listModels(): Promise<readonly { id: string }[]>;
  },
  model: string,
  timeoutMs = 3000,
): Promise<ModelPreflightResult> {
  const bounded = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`no answer within ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  try {
    const health = await bounded(provider.health());
    if (health.status !== 'ok') {
      return {
        ok: false,
        reason:
          `the model endpoint is ${health.status}` +
          (health.detail ? ` (${health.detail})` : ''),
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: `the model endpoint did not answer: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    const models = await bounded(provider.listModels());
    return { ok: true, listed: models.some((m) => m.id === model) };
  } catch {
    // A provider that can't enumerate models but is healthy still runs —
    // the list is advisory, the health check was the decision.
    return { ok: true, listed: true };
  }
}
