/**
 * Receipts — the C-6 append-only hash chain (DATABASE.md §2, BLUEPRINT §3.2).
 *
 * W10-47: this file was 553 lines, over the 400-line CODE_BOOK_PROTOCOL cap.
 * The implementation now lives in `receipts/` chapters and this file is a pure
 * re-export barrel.
 *
 * It stays at this exact path deliberately: `index.ts` and every consumer
 * import `./receipts.js` by name, so the split moved no call site. The chapter
 * boundaries are the ones docs/work/FILE_SIZE_DEBT.md derived — types <-
 * waiver-policy/mac <- mint/verify, query <- mint — a tree, no cycles.
 *
 * The serialization in `receipts/mac.ts` is the part that could not be undone
 * if it changed: every receipt already minted carries a MAC over a specific
 * byte sequence, and an append-only log cannot be migrated. `receipts-golden.
 * test.ts` pins those bytes with hex values frozen from the pre-split code.
 */

export type {
  ReceiptKind,
  ValidatorResult,
  ReceiptInputFile,
  ReceiptRecord,
} from './receipts/types.js';

export {
  DEFAULT_AGENT_NAME_BLOCKLIST,
  WaiverSignatureRequiredError,
  AgentWaiverRejectedError,
} from './receipts/waiver-policy.js';

export {
  SigningKeyRequiredError,
  computeInputTreeHash,
  computeReceiptMac,
  type ReceiptContent,
} from './receipts/mac.js';

export {
  mintReceipt,
  type MintReceiptInput,
  type MintReceiptOptions,
} from './receipts/mint.js';

export { getReceipt, getReceiptActor } from './receipts/query.js';

export {
  verifyReceipt,
  type ReceiptVerificationResult,
  type VerifyReceiptOptions,
} from './receipts/verify.js';
