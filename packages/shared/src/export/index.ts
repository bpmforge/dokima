export {
  computeBundleEventHash,
  GENESIS_HASH as EXPORT_BUNDLE_GENESIS_HASH,
  verifyBundleChain,
} from './hash-chain.js';
export type { BundleChainVerificationResult, BundleHashInput } from './hash-chain.js';
export { EXPORT_BUNDLE_VERSION } from './types.js';
export type {
  ExportBundle,
  ExportedEvent,
  ExportedIdentity,
  ExportedIdentityKind,
  ExportedReceipt,
} from './types.js';

/**
 * Deliberately minimal: this package originally also carried a JSON-schema
 * validator and a pure bundle builder mirroring
 * `apps/server/src/api/export-bundle-{validate,build}.ts` field-for-field —
 * a near-verbatim clone with no consumer (nothing outside this directory's
 * own tests imported it), which is exactly the "disconnected pipeline /
 * never called" pattern this codebase's own dead-code review flags as
 * CRITICAL. Trimmed to the one piece that is NOT duplicated anywhere else:
 * `hash-chain.ts`'s algorithm mirror, whose entire reason to exist is being
 * independently invocable without `@dokima/events`/SQLite (BLUEPRINT
 * §12.8 "no lock-in" — a bundle verifiable with nothing but this library
 * and the JSON file). `apps/server/src/api/export-hash-parity.test.ts`
 * proves this copy and `packages/events/src/hash.ts`'s agree on the same
 * inputs, so the two do not silently drift apart.
 *
 * Not re-exported from `packages/shared/src/index.ts` (the package root
 * barrel) — that file, and `packages/shared/package.json`'s `exports` map,
 * are both outside this ticket's `write_scope`
 * (`packages/shared/src/export/**` only). A future ticket wiring a real
 * consumer (a CLI `dokima bundle verify`, apps/web) needs one additive
 * line in the root barrel first — same "build-then-wire" seam as
 * `packages/shared/src/secrets` before commit e622661d.
 */
