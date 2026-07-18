/**
 * Barrel for the global gateway pool module (FR-F3, ARCHITECTURE §6,
 * D-013). NOTE: not re-exported from packages/gateway/src/index.ts — that
 * file is out of this ticket's write_scope (packages/gateway/src/pool/**
 * only), same gap W2-05/W3-04 left for their own modules. A future ticket
 * that owns src/index.ts should add a `./pool` export.
 *
 * Wiring note: this module provides the scheduling primitives
 * (`FairScheduler`, `GatewayPool`, `GlobalBerthGovernor`) as drop-in units.
 * Constructing one process-wide `GatewayPool`/`GlobalBerthGovernor` and
 * threading them through every project's gateway/Harbormaster calls is a
 * composition-root concern (`apps/server`), outside this ticket's
 * write_scope — same posture as berths.ts's `BerthTicketRunner` injection
 * point (W3-04).
 */

export { FairScheduler } from './fair-scheduler.js';

export { GatewayPool } from './gateway-pool.js';
export type { GatewayPoolOptions } from './gateway-pool.js';

export {
  GOVERNOR_SCOPE_PRECEDENCE,
  GlobalBerthGovernor,
  resolveGovernorCap,
} from './governor.js';
export type {
  GovernorScope,
  ResolvedGovernorCap,
  ThreeScopeGovernorCap,
} from './governor.js';
