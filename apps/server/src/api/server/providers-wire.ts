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
    enabled: v.enabled,
  };
}

