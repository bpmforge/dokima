/**
 * Server-side bundle build/validate/import barrel (BLUEPRINT §12.8, ROADMAP
 * W8 exit criterion "export/import round-trips with chain verification").
 * Split across export-bundle-{types,build,validate,import}.ts to stay under
 * the 400-line CODE_BOOK cap (W4-05) per file.
 *
 * This module does NOT import `packages/shared/src/export` (the pure,
 * portable bundle-format library that ticket's `write_scope` also covers):
 * `packages/shared`'s `package.json` `exports` map and its root barrel
 * (`packages/shared/src/index.ts`) only expose `.`/`./config`/`./secrets`
 * today, and adding a `./export` subpath means editing both — outside this
 * ticket's declared `write_scope` (`packages/shared/src/export/**` and
 * `apps/server/src/api/export*` only; NOT `packages/shared/package.json` or
 * `packages/shared/src/index.ts`). Same "build-then-wire" seam as
 * `packages/pipeline`'s decisions engine before W5-22, or `secrets` before
 * commit e622661d — the maker builds and unit-tests the primitive, then
 * correctly does not silently touch a file outside its scope to wire it up.
 * A future ticket adding the one-line barrel export lets this file switch
 * to importing the shared version instead of this hand-rolled one.
 *
 * The two bundle shapes are kept in sync by hand (field-for-field mirror,
 * see export-bundle-types.ts); the algorithmically load-bearing piece —
 * hash-chain verification — is NOT reimplemented here: `@shipwright/events`
 * is already a direct dependency of `apps/server`, so `verifyChain` is
 * reused as the single source of truth for what "valid chain" means
 * operationally, exactly as `packages/shared/src/export/hash-chain.ts`'s
 * own header documents doing independently for the portable (SQLite-free)
 * case.
 */
export { buildExportBundle } from './export-bundle-build.js';
export {
  importExportBundle,
  type ImportExportBundleOptions,
  type ImportResult,
} from './export-bundle-import.js';
export {
  BundleValidationError,
  ChainVerificationFailedError,
  EXPORT_BUNDLE_VERSION,
  NonEmptyImportTargetError,
  ReceiptAnchorVerificationFailedError,
  type BundleEvent,
  type BundleIdentity,
  type BundleReceipt,
  type ExportBundle,
} from './export-bundle-types.js';
export { validateExportBundle } from './export-bundle-validate.js';
