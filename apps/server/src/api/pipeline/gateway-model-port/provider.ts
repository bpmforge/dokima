/**
 * gateway-model-port/provider.ts — constructing the adapter the resolved KIND names.
 *
 * Chapter of the 450-line gateway-model-port.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48).
 *
 * W12-11: this file used to refuse `anthropic`/`openai`/`vertex`/`copilot`
 * outright, for two honest reasons that were both true — the registry stores a
 * `credentialRef` (a NAME) where the adapter needs a resolved secret, and a
 * paid API has no defensible $0 price table. Under D-024 a user may CHOOSE any
 * of these, so refusing them is no longer caution, it is a broken promise.
 * Both reasons are now removed rather than waived: the credential is resolved
 * through the keychain at call time (Law 8), and prices come from
 * `pricing.ts`, which REFUSES an unpriced model instead of metering it at $0.
 *
 * ASYNC, and that is load-bearing: `resolveCredentialRef` is async, so
 * construction is too. The alternative — resolving eagerly somewhere upstream
 * — would read secrets for providers a run never uses.
 */

import {
  createAnthropicProvider,
  createCopilotProvider,
  createLmStudioProvider,
  createOaiCompatProvider,
  createOllamaProvider,
  createOpenAiProvider,
  type Provider,
} from '@dokima/gateway';
import { resolveCredentialRef, resolveCredentialStore } from '@dokima/shared';
import { ModelResolutionError } from '../model-resolution.js';
import type { GatewayConfig } from './config.js';
import { costTableFor, stalePricingWarning, UNPRICED_BY_DESIGN } from './pricing.js';

/**
 * Hosts that are unmistakably paid endpoints reached through the generic
 * oai-compat adapter. THE LOOPHOLE THIS CLOSES (W12-11): pointing
 * `DOKIMA_MODEL_BASE_URL` at `https://api.openai.com/v1` routes a real paid
 * account through `createOaiCompatProvider`, which defaults to
 * `LOCAL_COST_TABLE` — literally `{}` — so every call meters $0 and the
 * budget breakers cannot fire. That path bypassed the very guard the cloud
 * refusal existed to enforce. Matching on host is deliberately conservative:
 * it catches the documented footgun without pretending to recognise every
 * paid endpoint in existence, and a self-hosted gateway on a private host
 * stays free, which it genuinely is.
 */
const PAID_OAI_COMPAT_HOSTS: ReadonlyArray<readonly [string, string]> = [
  ['api.openai.com', 'openai'],
  ['api.anthropic.com', 'anthropic'],
  ['api.mistral.ai', 'mistral'],
  ['api.groq.com', 'groq'],
  ['openrouter.ai', 'openrouter'],
];

function paidHostKind(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  let host: string;
  try {
    host = new URL(baseUrl).host.toLowerCase();
  } catch {
    return null;
  }
  for (const [needle, kind] of PAID_OAI_COMPAT_HOSTS) {
    if (host === needle || host.endsWith(`.${needle}`)) return kind;
  }
  return null;
}

/**
 * The credential, resolved. A `credentialRef` NAMES a keychain entry (Law 8);
 * `DOKIMA_MODEL_API_KEY` stays the documented CI path and wins only when no
 * ref was registered, preserving every existing fixture. An unresolvable ref
 * refuses BY NAME rather than falling through to an unauthenticated call that
 * would fail later with a vendor 401 nobody can act on.
 */
async function resolveApiKey(config: GatewayConfig, kind: string): Promise<string> {
  if (config.credentialRef) {
    try {
      return await resolveCredentialRef(
        resolveCredentialStore(process.env),
        config.credentialRef,
      );
    } catch (err) {
      throw new ModelResolutionError(
        `provider kind "${kind}" is registered with credential ref "${config.credentialRef}", ` +
          `but it could not be resolved: ${err instanceof Error ? err.message : String(err)}. ` +
          `Register the secret, or set DOKIMA_MODEL_API_KEY.`,
        'credential-unresolvable',
      );
    }
  }
  // The env key is read HERE and not only in `targetToConfig`, so a caller
  // that builds a `GatewayConfig` by hand (onboard-dispatch-port, tests) gets
  // the documented CI path too. Reading it in one place only was why the
  // fallback existed on paper and not in practice.
  const fromEnv = config.apiKey ?? process.env.DOKIMA_MODEL_API_KEY;
  if (fromEnv) return fromEnv;
  throw new ModelResolutionError(
    `provider kind "${kind}" needs a credential: register one (its ref is stored, never the secret) ` +
      `or set DOKIMA_MODEL_API_KEY. Refusing rather than calling a paid API unauthenticated.`,
    'credential-missing',
  );
}

/** Prices for a paid kind, refusing on unpriced; the stale warning is surfaced, never swallowed. */
function pricedTableFor(kind: string, model: string, warn: (msg: string) => void) {
  const lookup = costTableFor(kind, model);
  if (lookup.stale) warn(stalePricingWarning(lookup));
  return lookup.costTable;
}

export interface ProviderForConfigOptions {
  /** Where a stale-pricing warning goes. Defaults to stderr — it must never be silent. */
  readonly warn?: (message: string) => void;
}

export async function providerForConfig(
  config: GatewayConfig,
  options: ProviderForConfigOptions = {},
): Promise<Provider> {
  const id = config.providerId ?? 'pipeline-run';
  const warn = options.warn ?? ((m: string) => process.stderr.write(`[pricing] ${m}\n`));

  switch (config.kind) {
    case 'ollama':
      return createOllamaProvider(config.baseUrl ? { baseUrl: config.baseUrl } : {});
    case 'lm-studio':
      return createLmStudioProvider(config.baseUrl ? { baseUrl: config.baseUrl } : {});

    case 'anthropic':
      return createAnthropicProvider({
        id,
        apiKey: await resolveApiKey(config, 'anthropic'),
        costTable: pricedTableFor('anthropic', config.model, warn),
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
        ...(config.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: config.requestTimeoutMs }),
        ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
      });

    case 'openai':
      return createOpenAiProvider({
        id,
        apiKey: await resolveApiKey(config, 'openai'),
        costTable: pricedTableFor('openai', config.model, warn),
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
        ...(config.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: config.requestTimeoutMs }),
        ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
      });

    case 'copilot':
      // No resolved apiKey and no price table, and BOTH are correct rather
      // than gaps: Copilot owns an OAuth device-flow token it manages through
      // a credential STORE, and it is a flat-fee subscription with no public
      // per-token rate, so `LOCAL_COST_TABLE` ($0) is the honest figure — the
      // user already paid a fixed amount. See pricing.v1.json `notes.copilot`.
      return createCopilotProvider({
        id,
        credentialStore: resolveCredentialStore(process.env),
        ...(config.credentialRef ? { credentialRef: config.credentialRef } : {}),
        ...(config.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: config.requestTimeoutMs }),
        ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
      });

    case 'vertex':
      // STILL REFUSED, and for a different reason than before — stated so it
      // is not mistaken for the old blanket refusal. `createVertexProvider`
      // requires `project` and `location`, and `ProviderEntry` has nowhere to
      // put them (id/kind/baseUrl/credentialRef/requestTimeoutMs/enabled).
      // Inventing them from a baseUrl would be a guess about which GCP project
      // to bill. The registry needs the fields first: filed as W12-14.
      throw new ModelResolutionError(
        `provider kind "vertex" needs a GCP project and location, and the provider registry ` +
          `has no field for either (W12-14). Credentials and pricing are solved (W12-11); ` +
          `this is a registry-schema gap. Anthropic, OpenAI, Copilot and local kinds work today.`,
        'kind-not-constructible',
      );

    default: {
      // The generic oai-compat adapter — genuinely $0 for a local endpoint,
      // and a $0 fabrication for a paid one. See PAID_OAI_COMPAT_HOSTS.
      const paid = paidHostKind(config.baseUrl);
      const costTable =
        paid && !UNPRICED_BY_DESIGN.has(paid)
          ? pricedTableFor(paid, config.model, warn)
          : undefined;
      return createOaiCompatProvider({
        id,
        baseUrl: config.baseUrl,
        apiKey: config.credentialRef
          ? await resolveApiKey(config, config.kind ?? 'oai-compat')
          : config.apiKey,
        fetchImpl: config.fetchImpl,
        ...(costTable ? { costTable } : {}),
        // W10-57: the registry entry's own timeout, when it set one. Without
        // this the field was settable and inert.
        ...(config.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: config.requestTimeoutMs }),
      });
    }
  }
}
