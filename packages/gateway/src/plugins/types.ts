/**
 * plugins/types.ts — the provider/auth plugin seam (W12-27, D-026).
 *
 * D-026 decided that subscription sign-in never ships in core: Anthropic
 * banned third-party use of Claude Pro/Max OAuth outright in February 2026
 * (naming opencode), and OpenAI's "Sign in with ChatGPT" is for OpenAI's own
 * CLI with Terms that prohibit programmatic use. A user who wants it installs
 * a plugin, so the ToS exposure sits with whoever installed one rather than
 * with this product and every user of it.
 *
 * D-026 also stated the cost plainly and handed this ticket the bill: a plugin
 * seam is arbitrary code running in-process near the keychain, inside a
 * product whose thesis is that agent sessions are untrusted and the platform
 * holds the gates (C-2/C-3). "We hold the gates" must not quietly become
 * "except for plugins". The trust model is therefore part of the TYPE, not a
 * paragraph of guidance beside it — see docs/design/PLUGIN_SEAM.md for the
 * decision and the rejected alternatives.
 *
 * THE SHAPE OF THE ANSWER: a plugin never receives the vault. It declares one
 * provider id, and it is handed a context that can resolve only the credential
 * refs belonging to that entry. This is the same construction C-4 uses for
 * maker/verifier distinctness — a boundary that holds because the plugin is
 * never given the wider object, not because it is asked not to look.
 */

/** A credential ref the installer bound to this plugin's provider entry. */
export type ScopedCredentialRef = string;

/**
 * What a plugin may do, and nothing else.
 *
 * Deliberately NOT `@dokima/shared`'s `CredentialStore`. That interface has
 * `get(ref)` over the
 * whole vault, so handing it over would let a plugin registered for one
 * provider read the API key of another — the exfiltration acceptance 4 forbids.
 * This context closes over the refs bound to a single entry and refuses the
 * rest by construction.
 */
export interface PluginContext {
  /** The entry this plugin was installed against. */
  readonly providerId: string;
  /**
   * Resolves a ref BOUND TO THIS ENTRY. Throws `PluginScopeError` for any
   * other ref, including one that exists — a plugin must not be able to
   * discover the vault's contents by probing.
   */
  resolveCredential(ref: ScopedCredentialRef): Promise<string>;
  /**
   * Persists a credential for THIS entry — the refresh-token case, which is
   * the whole reason an auth plugin needs write access at all.
   */
  storeCredential(ref: ScopedCredentialRef, value: string): Promise<void>;
  /**
   * The plugin's own scratch space for non-secret state (an expiry timestamp,
   * a device id). Separate from credentials so that "remember this" never
   * becomes a reason to hand over the store.
   */
  readonly settings: Record<string, unknown>;
}

/**
 * What a plugin supplies. One method, because the seam every adapter already
 * exposes is `fetchImpl` — the same hook opencode's `loader` uses to swap an
 * API key for an OAuth bearer. A plugin decorates the call; it never becomes
 * the provider.
 */
export interface ProviderAuthPlugin {
  /** Stable identity, used in events and in the consent record. */
  readonly id: string;
  /** Human name, shown at the consent prompt. */
  readonly name: string;
  /** The single provider entry this plugin may act for (acceptance 4). */
  readonly providerId: string;
  /**
   * Returns the `fetch` the adapter will use. Called once per provider
   * construction, never per request, so a plugin cannot make itself a
   * per-request interceptor of traffic it has no business seeing.
   */
  authorize(ctx: PluginContext, inner: typeof fetch): Promise<typeof fetch>;
}

/** A plugin reached for a credential outside the entry it registered. */
export class PluginScopeError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly ref: string,
  ) {
    super(
      `plugin "${pluginId}" asked for credential ref "${ref}", which is not ` +
        `bound to the provider entry it registered. A plugin is scoped to one ` +
        `entry: it may not read, and may not probe for, any other.`,
    );
    this.name = 'PluginScopeError';
  }
}

/** `authorize` threw, hung, or returned something that is not a fetch. */
export class PluginFailedError extends Error {
  constructor(
    public readonly pluginId: string,
    reason: string,
  ) {
    super(
      `plugin "${pluginId}" could not authorize the provider: ${reason}. The ` +
        `provider is unavailable — it is NOT retried without credentials, ` +
        `because an unauthenticated call to a subscription endpoint is how an ` +
        `account gets flagged.`,
    );
    this.name = 'PluginFailedError';
  }
}

/*
 * The hang bound (30s) is specified in PLUGIN_SEAM.md §5 rather than exported
 * as a constant here. It is a parameter of `authorizeWithPlugin`, which this
 * ticket withholds, and a lone constant with nothing to configure is the same
 * unreachable-export problem one line long.
 */

/*
 * WHAT IS DELIBERATELY NOT HERE: `createPluginContext` and
 * `authorizeWithPlugin`.
 *
 * Both were written and tested while this ticket was open, and both were
 * withheld. W12-27's acceptance asks for "the design plus the TYPE surface",
 * and the export ratchet (`validate-exports`) refused them for the right
 * reason: they had no caller and would not have one until a loader exists.
 * This repository has produced fourteen mechanisms that landed complete,
 * tested and unreachable, and the ratchet's own rule is that the baseline is
 * never raised to make a change pass — including for a good excuse.
 *
 * Their specified behaviour lives in docs/design/PLUGIN_SEAM.md §3.1 and §5,
 * which is enough to build them from, and they belong to the loader ticket
 * (W12-44) where they will be constructed by a caller on the same commit.
 */

