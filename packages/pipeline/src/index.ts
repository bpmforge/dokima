export const PACKAGE_NAME = 'pipeline';

export * from './plans/index.js';
export * from './interview/index.js';
export * from './blueprint/index.js';
export * from './decisions/index.js';
export * from './decompose/index.js';
export * from './run/index.js';
export * from './phases/index.js';

/**
 * W13-18: the adaptive-depth ceiling, exported so the server route that
 * supplies follow-ups can enforce the same bound the engine does. A limit only
 * one caller honours is not a limit.
 */
export { MAX_FOLLOWUP_DEPTH } from './interview/depth-policy.js';
