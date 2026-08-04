/**
 * gateway-model-port/provider.ts — constructing the adapter the resolved KIND names, refusing cloud kinds by name.
 *
 * Chapter of the 450-line gateway-model-port.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import {
  createLmStudioProvider,
  createOaiCompatProvider,
  createOllamaProvider,
  type Provider,
} from '@dokima/gateway';
import { ModelResolutionError } from '../model-resolution.js';
import type { GatewayConfig } from './config.js';

export function providerForConfig(config: GatewayConfig): Provider {
  const id = config.providerId ?? 'pipeline-run';
  switch (config.kind) {
    case 'ollama':
      return createOllamaProvider(config.baseUrl ? { baseUrl: config.baseUrl } : {});
    case 'lm-studio':
      return createLmStudioProvider(config.baseUrl ? { baseUrl: config.baseUrl } : {});
    case 'anthropic':
    case 'openai':
    case 'vertex':
    case 'copilot':
      // Deliberately refused rather than faked. These adapters require inputs
      // this port cannot honestly supply yet: `AnthropicConfig.costTable` is
      // REQUIRED with no $0 default ("no $0 default for a paid API", its own
      // header), and the credential must be a resolved secret rather than the
      // `credentialRef` the registry stores. Wiring a keychain resolution +
      // price table is a follow-up ticket; until then a user who selects a
      // cloud provider gets a named refusal, never a silent fallback to
      // localhost, and never a fabricated $0 cost.
      throw new ModelResolutionError(
        `provider kind "${config.kind}" is registered but not yet constructible from the pipeline: it needs a resolved credential and a real price table (W10 follow-up). Local kinds (ollama, lm-studio, oai-compat) work today.`,
        'kind-not-constructible',
      );
    default:
      return createOaiCompatProvider({
        id,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        fetchImpl: config.fetchImpl,
        // W10-57: the registry entry's own timeout, when it set one. Without
        // this the field was settable and inert — the provider kept its
        // default no matter what the user configured.
        ...(config.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: config.requestTimeoutMs }),
      });
  }
}

