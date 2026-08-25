/**
 * W19-01 — the gate on the happy path.
 *
 * Same fixture technique as `../pipeline/phase-gate/runner.test.ts`: a
 * conforming `validate-mermaid` fixture script (envelope-correct) stands in
 * for the pack so the tests pin THIS module's wiring — gate → decideAdvance →
 * ledgered `phase.advanced` — not the content pack's own behaviour, which
 * runner.test.ts already covers against real content.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  createIdentity,
  listEvents,
  openEventLog,
  type EventLog,
} from '@dokima/events';
import {
  attemptPhaseProgress,
  currentPhaseFromLog,
  PHASE_ADVANCED_EVENT,
} from './run-phase-progress.js';

const SIGNING_KEY = 'test-signing-key-w19-01';
const AUTHOR = 'agent:builder';

async function mkTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-phase-progress-'));
  await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
  return dir;
}

async function mkConformingValidatorDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-fixture-validators-'));
  const script =
    '#!/bin/bash\n' +
    'echo \'{"validator":"validate-mermaid","gaps":0,"exit":0,"items":[]}\'\n';
  await fs.writeFile(path.join(dir, 'validate-mermaid.sh'), script, { mode: 0o755 });
  return dir;
}

async function mkFailingValidatorDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-fixture-validators-'));
  const script =
    '#!/bin/bash\n' +
    'echo \'{"validator":"validate-mermaid","gaps":1,"exit":1,"items":[{"severity":"ERROR","message":"planted defect"}]}\'\n' +
    'exit 1\n';
  await fs.writeFile(path.join(dir, 'validate-mermaid.sh'), script, { mode: 0o755 });
  return dir;
}

async function writePhase0Deliverables(projectDir: string): Promise<void> {
  await fs.writeFile(path.join(projectDir, 'docs/VISION.md'), '# Vision\n\nPlain.\n');
  await fs.writeFile(
    path.join(projectDir, 'docs/COMPETITIVE_ANALYSIS.md'),
    '# Competitive Analysis\n\nPlain.\n',
  );
}

/**
 * W21-07: this suite runs a REAL validator pack — it spawns validator
 * processes rather than stubbing them, which is the point of the fixtures.
 * At vitest's 5s default it fails under full-suite load and passes in
 * isolation, and the failures read "Test timed out in 5000ms" without ever
 * naming an assertion. The timeout is raised; nothing is stubbed out and no
 * assertion is loosened. (Same call as W20-13.)
 */
const GATE_TIMEOUT_MS = 30_000;

describe('attemptPhaseProgress (W19-01)', () => {
  let log: EventLog;
  let projectDir: string;
  const tempDirs: string[] = [];

  beforeEach(async () => {
    log = openEventLog(':memory:');
    createIdentity(log, { id: AUTHOR, name: AUTHOR, kind: 'machine' });
    projectDir = await mkTempProject();
    tempDirs.push(projectDir);
  });

  afterEach(async () => {
    log.close();
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  function args(contentDir: string) {
    return {
      log,
      projectId: 'p1',
      projectRoot: projectDir,
      authorActorId: AUTHOR,
      contentDir,
      signingKey: SIGNING_KEY,
      runId: 'run-1',
      now: () => new Date().toISOString(),
    };
  }

  it('RED FIXTURE: a clean run ADVANCES — gate mints, decideAdvance verifies, phase.advanced is ledgered with the receipt id. Fails if the happy path still never runs the gate (the shipped behaviour before W19-01: phase forever null, zero receipts)', async () => {
    await writePhase0Deliverables(projectDir);
    const contentDir = await mkConformingValidatorDir();
    tempDirs.push(contentDir);

    const outcome = await attemptPhaseProgress(args(contentDir));

    expect(outcome.phaseId).toBe(0);
    expect(outcome.advancedTo).toBe(1);
    const advanced = listEvents(log).filter((e) => e.eventType === PHASE_ADVANCED_EVENT);
    expect(advanced).toHaveLength(1);
    const payload = advanced[0]!.payload as {
      from: number;
      to: number;
      gate_receipt_id: string;
    };
    expect(payload.from).toBe(0);
    expect(payload.to).toBe(1);
    expect(payload.gate_receipt_id).toBeTruthy();
    expect(currentPhaseFromLog(log)).toBe(1);
    // The pass is told to the founder, not just ledgered.
    const digest = listEvents(log).find((e) => e.eventType === 'notification.emitted');
    expect(JSON.stringify(digest?.payload ?? '')).toContain('phase-advance-run-1-0');
  });

  it('a failing validator refuses: no phase.advanced, the refusal lands in the review queue with the gate reasons', async () => {
    await writePhase0Deliverables(projectDir);
    const contentDir = await mkFailingValidatorDir();
    tempDirs.push(contentDir);

    const outcome = await attemptPhaseProgress(args(contentDir));

    expect(outcome.advancedTo).toBeNull();
    expect(outcome.reasons.length).toBeGreaterThan(0);
    expect(listEvents(log).some((e) => e.eventType === PHASE_ADVANCED_EVENT)).toBe(false);
    expect(currentPhaseFromLog(log)).toBe(0);
    const notification = listEvents(log).find(
      (e) => e.eventType === 'notification.emitted',
    );
    expect(JSON.stringify(notification?.payload ?? '')).toContain('phase-gate-run-1-0');
  });

  it('missing deliverables refuse honestly — the novice project with no docs yet stays in phase 0 with a named reason, no crash', async () => {
    const contentDir = await mkConformingValidatorDir();
    tempDirs.push(contentDir);

    const outcome = await attemptPhaseProgress(args(contentDir));

    expect(outcome.advancedTo).toBeNull();
    expect(outcome.reasons.join(' ')).toMatch(/VISION|deliverable/i);
    expect(listEvents(log).some((e) => e.eventType === PHASE_ADVANCED_EVENT)).toBe(false);
  });

  it('currentPhaseFromLog reads the LATEST advance', () => {
    expect(currentPhaseFromLog(log)).toBe(0);
    appendEvent(log, {
      eventType: PHASE_ADVANCED_EVENT,
      actorId: AUTHOR,
      payload: { from: 0, to: 1 },
    });
    appendEvent(log, {
      eventType: PHASE_ADVANCED_EVENT,
      actorId: AUTHOR,
      payload: { from: 1, to: 2 },
    });
    expect(currentPhaseFromLog(log)).toBe(2);
  });
}, GATE_TIMEOUT_MS);
