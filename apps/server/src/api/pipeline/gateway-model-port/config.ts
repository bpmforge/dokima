/**
 * gateway-model-port/config.ts — resolving WHICH provider and model a pipeline call uses.
 *
 * Chapter of the 450-line gateway-model-port.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import { envTarget, resolveModelTarget, type ResolvedModelTarget } from '../model-resolution.js';

export interface GatewayConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  /** W12-11: the NAME of a keychain entry (Law 8), resolved at construction time — never the secret. */
  readonly credentialRef?: string;
  /** W12-14: GCP project/region, required for `vertex` and absent elsewhere. */
  readonly project?: string;
  readonly location?: string;
  readonly model: string;
  /** Which adapter to construct (W10-03). Absent => oai-compat, the pre-registry behaviour. */
  readonly kind?: import('@dokima/gateway').ProviderKind;
  /** Which registry entry this came from, for provenance in traces. */
  readonly providerId?: string;
  /** W10-57: the registry entry's own request timeout, when it set one. */
  readonly requestTimeoutMs?: number;
  /** W13-10: extra body fields for this endpoint (e.g. `reasoning_effort`). */
  readonly requestExtras?: Record<string, unknown>;
  /** Test-only override — real callers always get the real `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Local-first default (C-1): an LM Studio-shaped endpoint on localhost, zero
 * network required. Retained as the DOCUMENTED override for CI and fixtures
 * (the e2e fake-model gateway sets these), and now explicitly second in line
 * behind an explicit registry+matrix selection — see `model-resolution.ts`.
 */
export function resolveGatewayConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const t = envTarget(env);
  return {
    baseUrl: t.baseUrl ?? 'http://127.0.0.1:1234/v1',
    apiKey: env.DOKIMA_MODEL_API_KEY,
    model: t.model,
  };
}

/**
 * W10-03: resolve the provider+model the user actually chose, falling back to
 * the env config when nothing is configured. `projectPath` absent => env-only.
 */
export async function resolveGatewayConfigForProject(
  projectPath: string | undefined,
  opts: {
    role?: string;
    taskType?: 'reasoning' | 'code' | 'verification' | 'embed' | 'escalation';
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<GatewayConfig> {
  const target = await resolveModelTarget({
    projectPath,
    role: opts.role ?? 'coding-agent',
    taskType: opts.taskType ?? 'reasoning',
    env: opts.env,
  });
  return targetToConfig(target, opts.env ?? process.env, opts.fetchImpl);
}

export function targetToConfig(
  target: ResolvedModelTarget,
  env: NodeJS.ProcessEnv,
  fetchImpl?: typeof fetch,
): GatewayConfig {
  return {
    baseUrl: target.baseUrl ?? 'http://127.0.0.1:1234/v1',
    // A credentialRef NAMES a keychain entry; the keychain resolves it at call
    // time (Law 8). The env key remains the CI path only.
    apiKey: env.DOKIMA_MODEL_API_KEY,
    // W12-11: carried through so providerForConfig can resolve it via the
    // keychain. Previously dropped here, which is why the comment below
    // described a resolution that nothing performed.
    ...(target.credentialRef ? { credentialRef: target.credentialRef } : {}),
    ...(target.project ? { project: target.project } : {}),
    ...(target.location ? { location: target.location } : {}),
    model: target.model,
    kind: target.kind,
    providerId: target.providerId,
    // W10-57: without this the registry field was settable and inert — the
    // provider kept its kind default no matter what the user configured.
    ...(target.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: target.requestTimeoutMs }),
    ...(target.requestExtras === undefined
      ? {}
      : { requestExtras: target.requestExtras }),
    ...(fetchImpl ? { fetchImpl } : {}),
  };
}

/**
 * Constructs the adapter the resolved KIND names — not an unconditional
 * `createOaiCompatProvider`. This is what makes the Anthropic/Ollama/LM Studio
 * adapters reachable from a production path for the first time.
 */
