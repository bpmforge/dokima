/**
 * Captures the scribe-style screenshot tour under `docs/tour/` by driving
 * the real product — see `../lib/app-harness.mjs` for the boot/seed seams
 * (real build, real server, throwaway home, sanctioned seeding only,
 * Law 9: zero mocks, zero network).
 *
 * Two passes, each against its own fresh app instance (never a theme
 * re-toggled onto an already-populated app — that's exactly how the
 * mis-slugged dark/01-fleet-empty and dark/04-workspace-empty screenshots
 * happened, W10-37): a light-theme walkthrough (`light-pass.mjs`, `img/`,
 * the main narrative in TOUR.md, same flat layout `README.md`'s hero image
 * and `docs/work/RESUME_2026-08-02.md`'s historical note already link
 * into) and a dark-theme pass (`dark-pass.mjs`, `img/dark/`) that
 * re-proves the two empty states and sweeps every Settings tab. Every
 * state either gets captured or is declared WAIVED up front with a reason
 * (`declared-states.mjs`, checked by `../lib/state-coverage.mjs`) —
 * `tracker.finish()` throws if anything was silently skipped, so the
 * sweep can't sign off on coverage it doesn't have (W10-37 AC4, UX_SPEC
 * §2b).
 *
 * Book-split per CODE_BOOK_PROTOCOL.md (W10-37 gate: the single-file
 * script hit the 400-line cap): `declared-states.mjs` (the coverage
 * denominator), `shoot.mjs` (the screenshot + Settings-tab-sweep
 * helpers), `light-pass.mjs` / `dark-pass.mjs` (the two walkthroughs),
 * `tour-doc.mjs` (TOUR.md rendering). This file is the public barrel.
 *
 * Run from the repo root or apps/web:
 *   node apps/web/scripts/capture-tour/index.mjs
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { repoRoot, startApp } from '../lib/app-harness.mjs';
import { createCoverageTracker } from '../lib/state-coverage.mjs';
import { DECLARED_STATES } from './declared-states.mjs';
import { runDarkPass } from './dark-pass.mjs';
import { runLightPass } from './light-pass.mjs';
import { buildTourMarkdown } from './tour-doc.mjs';

const LIGHT_PORT = 4407;
const DARK_PORT = 4408;
const OUT_DIR = path.join(repoRoot, 'docs', 'tour');
const IMG_DIR = path.join(OUT_DIR, 'img');

const tracker = createCoverageTracker(DECLARED_STATES);
const steps = [];
const ctx = { tracker, steps, imgDir: IMG_DIR };

rmSync(IMG_DIR, { recursive: true, force: true });
mkdirSync(path.join(IMG_DIR, 'dark'), { recursive: true });

console.log('booting apps/server (light pass)…');
const lightApp = await startApp(LIGHT_PORT);
try {
  const browser = await chromium.launch();
  await runLightPass(browser, lightApp, ctx);
  await browser.close();
} finally {
  lightApp.stop();
}

console.log('booting apps/server (dark pass)…');
const darkApp = await startApp(DARK_PORT);
try {
  const browser = await chromium.launch();
  await runDarkPass(browser, darkApp, ctx);
  await browser.close();
} finally {
  darkApp.stop();
}

// ── Coverage report — declared vs. captured, per W10-37 AC4 ─────────────
const coverage = tracker.finish();

// ── TOUR.md ──────────────────────────────────────────────────────────
const lightSteps = steps.filter((s) => !s.id.startsWith('dark/'));
const darkSteps = steps.filter((s) => s.id.startsWith('dark/'));
const md = buildTourMarkdown(lightSteps, darkSteps, coverage);
writeFileSync(path.join(OUT_DIR, 'TOUR.md'), md);
console.log(
  `\nwrote ${lightSteps.length} light + ${darkSteps.length} dark steps to docs/tour/TOUR.md (${coverage.length} declared states, ${coverage.filter((c) => c.status === 'waived').length} waived)`,
);
