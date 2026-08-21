export const PACKAGE_NAME = 'forge';

export {
  pushToRemotes,
  type PushToRemotesOptions,
  type RemotePushResult,
} from './dual-remote.js';

/**
 * W16-04: the adapters and the mirror, exported for their first production
 * caller (apps/server's run-build push + forge-mirror composition). The
 * mirror subtree existed complete behind an unexported local barrel — the
 * same built-but-unreachable seam class as W12-04/W12-09/W13-23/W16-03.
 */
export { createGiteaForgeAdapter } from './gitea.js';
export { createGitHubForgeAdapter } from './github.js';
export type { ForgeAdapter, ForgeIdentity, RepoRef } from './types.js';
export { ForgeTimeoutError, ForgeUnreachableError } from './types.js';
export { attemptOrQueue, flushMirrorQueue } from './mirror/queue.js';
export type { MirrorFlushOutcome, QueuedMirrorWrite } from './mirror/queue.js';
export { writeThroughVerb } from './mirror/write-through.js';
export type { MirrorForgeAdapter } from './mirror/write-through.js';
export type {
  MirrorCloseReceiptSummary,
  MirrorWriteRequest,
  MirrorWriteResult,
} from './mirror/types.js';
