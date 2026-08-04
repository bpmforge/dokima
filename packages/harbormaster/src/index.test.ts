import { describe, expect, it } from 'vitest';
import * as harbormaster from './index.js';
import { PACKAGE_NAME } from './index.js';

describe('@dokima/harbormaster placeholder', () => {
  it('is scaffolded', () => {
    expect(PACKAGE_NAME).toBe('harbormaster');
  });
});

/**
 * W10-77 RED FIXTURE. This file used to assert one thing — that the package
 * name was the string 'harbormaster' — while the execution engine sat
 * unexported behind it. `runLandLoop`, `runClaimLoop` and `runCloseGate` were
 * implemented and tested across W3-01a/b/c, and `apps/server` could not reach
 * a single one of them: `package.json`'s exports map has one `.` entry, so a
 * deep import is not available, and `index.ts` re-exported only run
 * bookkeeping (`breakpoints`) and drift reconciliation (`resume`).
 *
 * A package's public surface is a contract, and nothing asserted it. That is
 * how "the engine is built" and "the engine is usable" stayed different facts
 * for three waves without anyone noticing.
 */
describe('@dokima/harbormaster public surface (W10-77)', () => {
  it.each([
    // The full claim -> session -> close-gate -> land path (W3-01c).
    'runLandLoop',
    // The claim loop on its own (W3-01a) — sessions without landing.
    'runClaimLoop',
    // Out-of-session gate execution (W3-01b): the only thing that may close.
    'runCloseGate',
    // The pieces a caller cannot construct the above without.
    'defaultHandoffBuilder',
    'createFileStopSwitch',
  ])('exports %s — the engine is reachable, not merely built', (name) => {
    expect(typeof (harbormaster as Record<string, unknown>)[name]).toBe('function');
  });

  it('exports the defaults a caller needs rather than making them re-derive them', () => {
    expect(harbormaster.DEFAULT_VERIFY_COMMAND).toContain('pnpm');
    expect(harbormaster.DEFAULT_MAX_SESSIONS_PER_TICKET).toBeGreaterThan(0);
    expect(harbormaster.DEFAULT_REQUIRED_VALIDATORS.length).toBeGreaterThan(0);
  });

  it('still exports the run bookkeeping and drift reconciliation it always did', () => {
    // Guards the widening: adding the engine must not drop what W3-03/FR-H3
    // callers already depend on.
    expect(typeof harbormaster.createRun).toBe('function');
    expect(typeof harbormaster.resumeProject).toBe('function');
  });
});
