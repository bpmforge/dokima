export { buildExportBundle, parseExportBundle } from './bundle.js';
export type { BuildExportBundleInput } from './bundle.js';
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
export { InvalidExportBundleError, validateExportBundle } from './validate.js';

/**
 * Not re-exported from `packages/shared/src/index.ts` (the package root
 * barrel) — that file, and `packages/shared/package.json`'s `exports` map,
 * are both outside this ticket's `write_scope`
 * (`packages/shared/src/export/**` only). Consumers today reach this module
 * only via relative import from within `packages/shared` (see this
 * directory's own tests); a future ticket wiring a consumer (a CLI
 * `shipwright bundle verify`, apps/web, or `apps/server`) needs one
 * additive line in the root barrel first — same "build-then-wire" seam as
 * `packages/shared/src/secrets` before commit e622661d.
 */
