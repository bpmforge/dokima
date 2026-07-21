/**
 * Session-trace fetchers. Re-exports rather than duplicates
 * `apps/web/src/board/drawer/api.ts`'s `fetchTicketRuns`/`fetchRunTrace` —
 * same `GET /tickets/{id}/runs` / `GET /runs/{id}/trace` endpoints back
 * both this dedicated replay view and the drawer's inline stopgap
 * (`TelemetryPanel.tsx`, W7-05); the drawer module is outside this
 * ticket's write_scope, so this file is the single import site the trace
 * view depends on instead of reaching into `board/drawer/**` directly.
 */
export { fetchRunTrace, fetchTicketRuns } from '../board/drawer/api.js';
export type { TraceEvent } from '../board/drawer/types.js';
