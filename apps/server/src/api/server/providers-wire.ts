/**
 * providers-wire.ts — the HTTP shape of a provider entry, and its mapping to
 * the registry's own shape.
 *
 * Split out of `providers-routes.ts` under the 400-line CODE_BOOK_PROTOCOL cap
 * (W13-10 took it to 405), and the seam is a real one: the wire uses
 * snake_case and is a published contract, while `ProviderEntry` is the
 * registry's internal shape. Keeping the translation in one place is also what
 * makes the allowlist below reviewable — every field must be listed twice, and
 * a field missing from either direction is settable and inert.
 */
import type { ProviderEntry, ProviderKind } from '@dokima/gateway';

export interface WireProvider {
  id: string;
  kind: ProviderKind;
  base_url?: string;
  credential_ref?: string;
  /** W12-25: required for `vertex` — which GCP project and region get billed. */
  project?: string;
  location?: string;
  /** W13-10: extra chat-request body fields for this endpoint. */
  request_extras?: Record<string, unknown>;
  /**
   * W10-57's per-entry timeout, which never reached this contract.
   *
   * The registry has carried `requestTimeoutMs` since W10-57 — its type
   * comment exists for exactly this case: "a 70B on a laptop can exceed even
   * 300s". Validation accepts it and `targetToConfig` threads it to the
   * provider. It was missing from BOTH directions here, which this module's
   * own header calls out as the failure mode: "a field missing from either
   * direction is settable and inert". So the one knob that lets a slow local
   * box finish a long step was reachable only by hand-editing settings JSON,
   * never through the product.
   *
   * Measured 2026-08-28: the resume that builds the board timed out at the
   * 300s default three times in a row on local models, and nothing in the API
   * or the UI could ask for longer.
   */
  request_timeout_ms?: number;
  enabled: boolean;
}

export function toWire(entry: ProviderEntry): WireProvider {
  return {
    id: entry.id,
    kind: entry.kind,
    ...(entry.baseUrl === undefined ? {} : { base_url: entry.baseUrl }),
    ...(entry.credentialRef === undefined ? {} : { credential_ref: entry.credentialRef }),
    ...(entry.project === undefined ? {} : { project: entry.project }),
    ...(entry.location === undefined ? {} : { location: entry.location }),
    ...(entry.requestExtras === undefined
      ? {}
      : { request_extras: entry.requestExtras }),
    ...(entry.requestTimeoutMs === undefined
      ? {}
      : { request_timeout_ms: entry.requestTimeoutMs }),
    enabled: entry.enabled,
  };
}


export function fromWire(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const v = raw as Record<string, unknown>;
  return {
    id: v.id,
    kind: v.kind,
    baseUrl: v.base_url ?? v.baseUrl,
    credentialRef: v.credential_ref ?? v.credentialRef,
    // W12-25: another allowlist. Without these the browser could send a GCP
    // project, this mapper would drop it, and the registry would refuse the
    // entry for a field the user demonstrably filled in.
    project: v.project,
    location: v.location,
    // W13-10: same allowlist reasoning — dropped here, the registry would
    // refuse (or silently ignore) a field the user demonstrably filled in.
    requestExtras: v.request_extras ?? v.requestExtras,
    // W10-57's field, same allowlist reasoning. The registry validates it as a
    // positive integer and refuses anything else, so a bad value is reported
    // rather than coerced — this mapper only has to stop dropping it.
    requestTimeoutMs: v.request_timeout_ms ?? v.requestTimeoutMs,
    enabled: v.enabled,
  };
}

