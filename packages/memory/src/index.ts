export const PACKAGE_NAME = 'memory';

/**
 * FR-L5/FR-L8 Context Packer (W12-04). `packer/index.ts` has existed since
 * FR-L5 landed and was never re-exported here — its own header says why:
 * this file was outside that ticket's `write_scope`. The effect was that
 * `assemblePacket` had zero callers not because nothing wanted it, but
 * because nothing could reach it (TECH_STACK forbids deep imports across
 * package boundaries). `code-index/` still has the same unexported local
 * barrel; it stays that way until something needs it.
 */
export * from './packer/index.js';

export * from './lessons/report.js';
export * from './lessons/triage.js';
export * from './lessons/types.js';
export * from './lessons/events.js';
