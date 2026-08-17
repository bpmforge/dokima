/**
 * settings/providers-auth-methods.ts — which auth shapes a provider kind supports.
 *
 * Chapter of providers-api.ts, split under the 400-line CODE_BOOK_PROTOCOL cap
 * the moment W12-25's project-scope work pushed that file to 421 lines. Fourth
 * accretion catch of this wave (policy.ts, run-build.ts, ProvidersPanel.tsx
 * were the others) — every one of them several reasonable appends rather than
 * one oversized write, which is the case a per-FILE cap exists for and a
 * per-diff cap structurally cannot see.
 */
import type { ProviderKind } from './providers-api.js';

/**
 * How a person proves they may use a provider (W12-21).
 *
 * NOT A BOOLEAN, and that is the point. The panel used to show one always-on
 * API-key box, so "use the subscription I already pay for" had nowhere to
 * live. There are at least four shapes and they are genuinely different:
 *
 *  - `none`         local kinds — nothing to prove, nothing to store.
 *  - `api-key`      a secret the user pastes once; exchanged for a keychain
 *                   ref through POST /providers/credentials (Law 8).
 *  - `subscription` an OAuth/device flow against something already paid for.
 *                   Copilot is the built example: `createCopilotProvider`
 *                   takes a credential STORE, not a key, and meters $0
 *                   because a flat fee has no public per-token price
 *                   (pricing.v1.json `notes.copilot`).
 *  - `gcp-adc`      Google Application Default Credentials — a service-account
 *                   JSON ref, or ambient credentials from
 *                   `gcloud auth application-default login`. Vertex only, and
 *                   the shape that proved this could not be api-key-vs-oauth
 *                   (TECH_STACK.md: "Vertex auth = ADC, not API keys", D-007).
 */
export type AuthMethod = 'none' | 'api-key' | 'subscription' | 'gcp-adc';

export const AUTH_METHOD_LABEL: Record<AuthMethod, string> = {
  none: 'No credentials needed (runs on this machine)',
  'api-key': 'API key',
  subscription: 'Sign in to a subscription I already pay for',
  'gcp-adc': 'Google Cloud credentials',
};

const AUTH_METHODS_BY_KIND: Record<ProviderKind, readonly AuthMethod[]> = {
  ollama: ['none'],
  'lm-studio': ['none'],
  // A self-hosted endpoint may or may not want a key — genuinely both, and
  // `api-key` leads because that field has ALWAYS been optional here ("API key
  // (optional)"). Leading with `none` would hide it and change behaviour for
  // every existing oai-compat user pointing at a paid host; leaving it first
  // preserves what they had while making the choice explicit for the first
  // time. Blank still means no credential, exactly as before.
  'oai-compat': ['api-key', 'none'],
  anthropic: ['api-key'],
  openai: ['api-key'],
  vertex: ['gcp-adc'],
  copilot: ['subscription'],
};

/**
 * The methods a kind supports. Anthropic gains `subscription` when W12-22
 * lands its Claude Pro/Max flow, and OpenAI only if W12-23's spike finds a
 * supported path — neither is listed on a guess, because an auth option that
 * cannot work is worse than one that is absent.
 */
export function authMethodsFor(kind: ProviderKind): readonly AuthMethod[] {
  return AUTH_METHODS_BY_KIND[kind] ?? ['api-key'];
}

/** The method to preselect: the only one, or the first, never a hidden default. */
export function defaultAuthMethod(kind: ProviderKind): AuthMethod {
  return authMethodsFor(kind)[0] ?? 'api-key';
}
