/**
 * The throwaway locations the E2E server runs against. Shared by
 * `playwright.config.ts` (which passes them to the server as env) and
 * `global-setup.ts` (which clears them before each run), so the two cannot
 * drift apart — a stale copy in one of them would silently mean "cleared a
 * directory nobody uses" while the real one kept accumulating (W9-14).
 */
import os from 'node:os';
import path from 'node:path';

export const PORT = 4402;
export const HOME = path.join(os.tmpdir(), 'shipwright-web-e2e-home');
export const STATE_DB = path.join(os.tmpdir(), 'shipwright-web-e2e-state.db');
