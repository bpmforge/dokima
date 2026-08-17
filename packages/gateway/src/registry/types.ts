/**
 * Provider registry types (W10-01, FR-G1).
 *
 * Before this module the only "registry" was a bare `providers` key read out
 * of the three-scope settings file by two CLI commands —
 * `apps/server/src/cli/ops/providers-core.ts` says so verbatim: "There is no
 * persisted provider registry yet anywhere in the codebase." This gives that
 * key a typed, validated shape that both the CLI and the REST surface can
 * agree on, WITHOUT changing where it is stored: it stays the same
 * `providers` settings key, so `dokima doctor` and `dokima providers refresh`
 * keep working against exactly the same data the GUI writes. One source of
 * truth, not two.
 *
 * Deliberately pure — types plus structural validation, no I/O and no secret
 * patterns. Persistence is `apps/server`'s job (it owns the settings engine),
 * and the credential *refusal* lives at the route boundary so a literal key is
 * rejected before anything is written, never "stored then scrubbed".
 */

/** The adapter kinds `buildProvider` already knows how to construct. */
export type ProviderKind =
  'ollama' | 'lm-studio' | 'oai-compat' | 'anthropic' | 'openai' | 'vertex' | 'copilot';

export const PROVIDER_KINDS: readonly ProviderKind[] = [
  'ollama',
  'lm-studio',
  'oai-compat',
  'anthropic',
  'openai',
  'vertex',
  'copilot',
];

/** Kinds that address a user-supplied endpoint and therefore require a baseUrl. */
export const ENDPOINT_KINDS: readonly ProviderKind[] = ['oai-compat'];

/**
 * Kinds addressed by a cloud PROJECT rather than a URL (W12-14). Vertex bills
 * a specific GCP project in a specific region, and neither is derivable from
 * anything else on the entry — inferring them from a `baseUrl` fragment would
 * be a guess about WHICH ACCOUNT GETS BILLED, the same class of fabrication as
 * metering a paid call at $0.
 */
export const PROJECT_SCOPED_KINDS: readonly ProviderKind[] = ['vertex'];

/**
 * Kinds gated behind an explicit, ledgered consent acknowledgement (D-019).
 * Copilot's `copilot_internal` flow is undocumented API and GitHub enforcement
 * can permanently ban the user's account, so it is never enabled by a plain
 * registry write.
 */
export const CONSENT_GATED_KINDS: readonly ProviderKind[] = ['copilot'];

export interface ProviderEntry {
  /** Stable, user-visible handle; also the id the role matrix routes against. */
  readonly id: string;
  readonly kind: ProviderKind;
  /** Required for `oai-compat`; ignored (and rejected) for kinds with a fixed endpoint. */
  readonly baseUrl?: string;
  /**
   * A NAMED KEYCHAIN REFERENCE, never a credential (Law 8, FR-S2, D-012).
   * The keychain resolves it at call time; nothing here ever holds the secret.
   */
  readonly credentialRef?: string;
  /**
   * Per-entry request timeout (W10-57). A slow local box and a fast hosted
   * endpoint must not be forced to share one number: the local default is
   * already 300s and the cloud kinds are 60s, but a 70B on a laptop can
   * exceed even 300s while a hosted endpoint that hangs for 300s is a bug you
   * want surfaced in 30. Absent means the provider kind's own default.
   */
  readonly requestTimeoutMs?: number;
  /**
   * GCP project id — required for `vertex`, meaningless elsewhere (W12-14).
   * This is the field whose absence made Vertex the one cloud kind that still
   * refused at construction after W12-11 solved credentials and pricing.
   */
  readonly project?: string;
  /** GCP region (e.g. `us-central1`) — required for `vertex`, meaningless elsewhere. */
  readonly location?: string;
  readonly enabled: boolean;
}

export class ProviderRegistryError extends Error {
  constructor(
    message: string,
    /** Machine-readable rule name, surfaced to the API caller so a refusal is explainable. */
    public readonly rule: string,
  ) {
    super(message);
    this.name = 'ProviderRegistryError';
  }
}
