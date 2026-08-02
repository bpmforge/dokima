/**
 * Shared boot/seed helpers for the screenshot tour (`capture-tour.mjs`) and
 * the acceptance walker (`capture-acceptance.mjs`): a real `vite build`
 * served by the real apps/server against a throwaway `.dokima` home
 * (same shape as playwright.config.ts's webServer). Population goes only
 * through sanctioned seams — the UI, real API routes, and the e2e seed
 * fixtures. Zero mocks, zero network beyond 127.0.0.1 (Law 9).
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const webRoot = path.resolve(here, '../..');
export const repoRoot = path.resolve(webRoot, '../..');
const serverRoot = path.join(repoRoot, 'apps', 'server');
export const TSX_BIN = path.join(serverRoot, 'node_modules', '.bin', 'tsx');
const SEED_SCRIPT = path.join(webRoot, 'e2e', 'fixtures', 'seed-board-tickets.mjs');
const TRACE_SCRIPT = path.join(webRoot, 'scripts', 'seed-tour-trace.mjs');

export function ensureSpaBuilt() {
  if (existsSync(path.join(webRoot, 'dist', 'index.html'))) return;
  console.log('dist missing — building the SPA first…');
  execFileSync('pnpm', ['--filter', '@dokima/web', 'run', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

async function waitForHealthz(base) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server never became healthy at ${base}/healthz`);
}

/** Boots the real server on `port` against throwaway dirs; `stop()` kills it and cleans up. */
export async function startApp(port) {
  ensureSpaBuilt();
  const home = mkdtempSync(path.join(os.tmpdir(), 'dokima-capture-home-'));
  const projectDir = mkdtempSync(path.join(os.tmpdir(), 'dokima-capture-project-'));
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(TSX_BIN, ['src/api/main.ts'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      DOKIMA_HOME: home,
      DOKIMA_PORT: String(port),
      DOKIMA_STATE_DB: path.join(home, 'capture-state.db'),
    },
    stdio: 'ignore',
  });
  await waitForHealthz(base);
  return {
    base,
    projectDir,
    stop() {
      server.kill();
      rmSync(home, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    },
  };
}

/** Seeds the demo board (basic scenario) + session-trace run events through the real event log. */
export function seedDemoBoard(projectDir) {
  const projectDb = path.join(projectDir, '.dokima', 'state.db');
  execFileSync(TSX_BIN, [SEED_SCRIPT, projectDb, 'basic'], { stdio: 'inherit' });
  execFileSync(TSX_BIN, [TRACE_SCRIPT, projectDb], { stdio: 'inherit' });
}

/** The evaluate-route snapshot every capture uses: 2 stale receipts -> proposes PC-001. */
export const PLAN_SNAPSHOT = {
  phase: null,
  receipts: { staleCount: 2 },
  coverage: { requiredSkipped: 0 },
  findings: { openCriticalUnwaived: 0 },
  rules: { fpHeavyCount: 0 },
  tickets: { oscillatingCount: 0, blockedWithEvidenceMaxAgeDays: 0 },
  spend: { thresholdBreachRepeatCount: 0 },
  gates: { missingRedFixtureCount: 0 },
  providers: { unverifiedTosCount: 0 },
  deliverables: { orphanedCount: 0 },
  planItems: { regressedCount: 0 },
  playbook: { staleEntryCount: 0 },
};
