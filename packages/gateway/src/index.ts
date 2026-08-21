export const PACKAGE_NAME = 'gateway';

export * from './providers/index.js';
export * from './registry/index.js';
export * from './catalog/index.js';
export * from './routing/index.js';
export * from './escalation/index.js';
export * from './budget/index.js';
export * from './fitness/index.js';

/**
 * W16-02: the process-wide pool layer, exported for its first production
 * caller (apps/server's berths path + pooled provider wrapper). NARROW:
 * the two classes the composition root constructs — the rest of pool/
 * stays unexported until something needs it.
 */
export { GatewayPool } from './pool/gateway-pool.js';
export { GlobalBerthGovernor } from './pool/governor.js';
