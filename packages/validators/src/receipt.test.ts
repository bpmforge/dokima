import {
  computeInputTreeHash,
  createIdentity,
  getReceipt,
  openEventLog,
  verifyReceipt,
  type EventLog,
  type ReceiptInputFile,
} from '@shipwright/events';
import { afterEach, describe, expect, it } from 'vitest';
import { mintValidatorRunReceipt } from './receipt.js';
import type { ValidatorRunResult } from './run.js';
import { createTempDbPath, type TempDb } from './test-helpers.js';

const NOW = () => '2026-07-12T00:00:00.000Z';
const TEST_SIGNING_KEY = 'test-minting-secret-w1-02';

const FILES: ReceiptInputFile[] = [{ path: 'docs/ARCHITECTURE.md', content: 'v1' }];

function cleanResult(name: string): ValidatorRunResult {
  return {
    name,
    exitCode: 0,
    gapCount: 0,
    gaps: [],
    stdout: `{"validator":"${name}","gaps":0,"exit":0,"items":[]}`,
    stderr: '',
    durationMs: 12,
    timedOut: false,
  };
}

function gappyResult(name: string): ValidatorRunResult {
  return {
    name,
    exitCode: 1,
    gapCount: 1,
    gaps: [{ category: 'x', detail: 'y' }],
    stdout: `{"validator":"${name}","gaps":1,"exit":1,"items":[{"category":"x","detail":"y"}]}`,
    stderr: '',
    durationMs: 12,
    timedOut: false,
  };
}

describe('mintValidatorRunReceipt', () => {
  let temp: TempDb;
  let log: EventLog;

  afterEach(async () => {
    log?.close();
    await temp?.cleanup();
  });

  it('mints a gate receipt through the W0-05 API — validators[] carries name/exitCode/gapCount', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    createIdentity(
      log,
      { id: 'runner-1', name: 'validator-runner', kind: 'machine' },
      { now: NOW },
    );

    const receipt = mintValidatorRunReceipt(
      log,
      {
        id: 'receipt-w1-02-1',
        kind: 'gate',
        projectId: 'proj-1',
        phase: 1,
        inputFiles: FILES,
        results: [cleanResult('validate-adrs'), cleanResult('validate-file-size')],
        actorId: 'runner-1',
      },
      { now: NOW, signingKey: TEST_SIGNING_KEY },
    );

    expect(receipt.validators).toEqual([
      { name: 'validate-adrs', exitCode: 0, gapCount: 0 },
      { name: 'validate-file-size', exitCode: 0, gapCount: 0 },
    ]);
    expect(receipt.verifyExit).toBe(0);
    expect(receipt.inputTreeHash).toBe(computeInputTreeHash(FILES));
    expect(getReceipt(log, 'receipt-w1-02-1')).toEqual(receipt);

    const verification = verifyReceipt(log, 'receipt-w1-02-1', {
      signingKey: TEST_SIGNING_KEY,
      inputFiles: FILES,
      requiredValidators: ['validate-adrs', 'validate-file-size'],
    });
    expect(verification).toEqual({ valid: true, reasons: [] });
  });

  it('records a non-zero verifyExit and per-validator exit codes when a validator reports gaps', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    createIdentity(
      log,
      { id: 'runner-1', name: 'validator-runner', kind: 'machine' },
      { now: NOW },
    );

    const receipt = mintValidatorRunReceipt(
      log,
      {
        id: 'receipt-w1-02-2',
        kind: 'gate',
        projectId: 'proj-1',
        inputFiles: FILES,
        results: [cleanResult('validate-adrs'), gappyResult('validate-no-ascii-art')],
        actorId: 'runner-1',
      },
      { now: NOW, signingKey: TEST_SIGNING_KEY },
    );

    expect(receipt.verifyExit).toBe(1);
    expect(receipt.validators).toEqual([
      { name: 'validate-adrs', exitCode: 0, gapCount: 0 },
      { name: 'validate-no-ascii-art', exitCode: 1, gapCount: 1 },
    ]);

    // Gate currency (BLUEPRINT §3.2): a required validator that didn't
    // exit 0 makes the receipt stale for that requirement.
    const verification = verifyReceipt(log, 'receipt-w1-02-2', {
      signingKey: TEST_SIGNING_KEY,
      inputFiles: FILES,
      requiredValidators: ['validate-adrs', 'validate-no-ascii-art'],
    });
    expect(verification.valid).toBe(false);
    expect(verification.reasons[0]).toMatch(/validate-no-ascii-art/);
  });
});
