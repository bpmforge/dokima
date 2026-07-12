import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent } from './append.js';
import { createIdentity } from './identities.js';
import { openEventLog } from './db.js';
import {
  AgentWaiverRejectedError,
  computeInputTreeHash,
  computeReceiptMac,
  DEFAULT_AGENT_NAME_BLOCKLIST,
  getReceipt,
  getReceiptActor,
  mintReceipt,
  SigningKeyRequiredError,
  verifyReceipt,
  WaiverSignatureRequiredError,
  type ReceiptInputFile,
} from './receipts.js';
import { createTempDbPath, type TempDb } from './test-helpers.js';
import type { EventLog } from './types.js';

const NOW = () => '2026-07-11T00:00:00.000Z';

// The minting secret the trusted path (Harbormaster) would resolve from the
// keychain (FR-S2). In production it never appears in agent-session context;
// here it stands in for that keychain-held value. The forgery fixtures below
// model the untrusted attacker precisely by *not* having it.
const TEST_SIGNING_KEY = 'test-minting-secret-1e7c';

function seedIdentities(log: EventLog): void {
  createIdentity(log, { id: 'human-1', name: 'Brad', kind: 'human' }, { now: NOW });
  createIdentity(
    log,
    { id: 'coding-agent', name: 'coding-agent', kind: 'machine' },
    { now: NOW },
  );
}

const FILES: ReceiptInputFile[] = [
  { path: 'docs/SRS.md', content: 'v1' },
  { path: 'pnpm-lock.yaml', content: 'lockfile-v1' },
];

describe('receipts', () => {
  let temp: TempDb;
  let log: EventLog;

  afterEach(async () => {
    log?.close();
    await temp?.cleanup();
  });

  it('FR-P1: mints a receipt recording validator list, exit codes, gap counts, input-tree hash, ts, and actor', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);

    const receipt = mintReceipt(
      log,
      {
        id: 'receipt-1',
        kind: 'gate',
        projectId: 'proj-1',
        phase: 3,
        validators: [{ name: 'lint', exitCode: 0, gapCount: 0 }],
        inputFiles: FILES,
        verifyCommand: 'pnpm lint',
        verifyExit: 0,
        actorId: 'human-1',
      },
      { now: NOW, signingKey: TEST_SIGNING_KEY },
    );

    expect(receipt.inputTreeHash).toBe(computeInputTreeHash(FILES));
    expect(receipt.validators).toEqual([{ name: 'lint', exitCode: 0, gapCount: 0 }]);
    expect(receipt.createdAt).toBe(NOW());
    expect(getReceipt(log, 'receipt-1')).toEqual(receipt);
    // actor is not a receipts column — it rides on the anchoring event (C3).
    expect(getReceiptActor(log, 'receipt-1')).toBe('human-1');
  });

  it('C3: the minting secret is required — a missing/empty key is rejected, never silently defaulted', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);

    expect(() =>
      mintReceipt(
        log,
        {
          id: 'no-key',
          kind: 'gate',
          projectId: 'proj-1',
          validators: [{ name: 'lint', exitCode: 0, gapCount: 0 }],
          inputFiles: FILES,
          actorId: 'human-1',
        },
        { now: NOW, signingKey: '' },
      ),
    ).toThrow(SigningKeyRequiredError);
  });

  it('C3: a receipt is only ever produced by mintReceipt — inserting a row directly leaves it unanchored (no gate.receipt_minted event) and fails verification', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);

    // Fabricated receipt JSON: a row inserted straight into the table,
    // simulating a hand-written receipt with no real validator run behind it.
    log.db
      .prepare(
        `INSERT INTO receipts
           (id, kind, project_id, phase, ticket_id, validators, input_tree_hash,
            verify_command, verify_exit, signed_by, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'forged-1',
        'gate',
        'proj-1',
        3,
        null,
        JSON.stringify([{ name: 'lint', exitCode: 0, gapCount: 0 }]),
        computeInputTreeHash(FILES),
        'pnpm lint',
        0,
        null,
        'null',
        NOW(),
      );

    const result = verifyReceipt(log, 'forged-1', {
      inputFiles: FILES,
      requiredValidators: ['lint'],
      signingKey: TEST_SIGNING_KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/not minted by a real run/);
  });

  it('C3: a forged gate row + a self-consistent anchoring event the attacker tagged with its own key still fails — the tag is a keyed MAC over the minting secret the attacker lacks', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);

    // This is the CRITICAL case: an untrusted caller with a `log.db` handle
    // and the full source of computeReceiptMac (so it knows the exact
    // algorithm) forges a gate receipt row AND a matching anchoring event.
    // Because it does not hold the minting secret, the only MAC it can
    // produce is under a key of its own choosing — which will not equal the
    // one verifyReceipt recomputes under the real secret. Gate receipts are
    // the case Law #4 is about ("never let a component verify its own
    // output"); this proves they are protected mechanically, not just waivers.
    const attackerKey = 'attacker-guessed-key';
    const content = {
      id: 'forged-gate',
      kind: 'gate' as const,
      projectId: 'proj-1',
      phase: 3,
      ticketId: null,
      validators: [{ name: 'lint', exitCode: 0, gapCount: 0 }],
      inputTreeHash: computeInputTreeHash(FILES),
      verifyCommand: 'pnpm lint',
      verifyExit: 0,
      signedBy: null,
    };
    const forgedMac = computeReceiptMac(content, attackerKey);

    log.db
      .prepare(
        `INSERT INTO receipts
           (id, kind, project_id, phase, ticket_id, validators, input_tree_hash,
            verify_command, verify_exit, signed_by, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        content.id,
        content.kind,
        content.projectId,
        content.phase,
        content.ticketId,
        JSON.stringify(content.validators),
        content.inputTreeHash,
        content.verifyCommand,
        content.verifyExit,
        content.signedBy,
        'null',
        NOW(),
      );
    appendEvent(
      log,
      {
        eventType: 'gate.receipt_minted',
        actorId: 'coding-agent',
        ticketId: null,
        payload: { receiptId: content.id, kind: content.kind, contentMac: forgedMac },
      },
      { now: NOW },
    );

    const result = verifyReceipt(log, 'forged-gate', {
      inputFiles: FILES,
      requiredValidators: ['lint'],
      signingKey: TEST_SIGNING_KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/not minted by a real run/);
  });

  it('C3: a forged receipts row paired with a naively-forged anchoring event (same receiptId, no real MAC) still fails verification', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);

    // A cruder forgery than the one above: the attacker doesn't even bother
    // computing a MAC, it just copies the shape of a real event and drops in
    // a placeholder. Kept as a distinct fixture because it exercises the
    // "MAC present but wrong" branch of the anchor check separately from the
    // "no event at all" branch (forged-1).
    log.db
      .prepare(
        `INSERT INTO receipts
           (id, kind, project_id, phase, ticket_id, validators, input_tree_hash,
            verify_command, verify_exit, signed_by, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'forged-2',
        'gate',
        'proj-1',
        3,
        null,
        JSON.stringify([{ name: 'lint', exitCode: 0, gapCount: 0 }]),
        computeInputTreeHash(FILES),
        'pnpm lint',
        0,
        null,
        'null',
        NOW(),
      );
    appendEvent(
      log,
      {
        eventType: 'gate.receipt_minted',
        actorId: 'human-1',
        ticketId: null,
        payload: { receiptId: 'forged-2', kind: 'gate', contentMac: 'not-a-real-mac' },
      },
      { now: NOW },
    );

    const result = verifyReceipt(log, 'forged-2', {
      inputFiles: FILES,
      requiredValidators: ['lint'],
      signingKey: TEST_SIGNING_KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/not minted by a real run/);
  });

  it('FR-P2: even a validly-tagged agent-signed waiver is rejected by the independent re-check', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);

    // The MAC guard alone catches a *key-less* forgery. This test isolates
    // the *second*, independent waiver guard: it constructs a row + event
    // whose MAC is valid under the real minting secret (as if minted by the
    // secret-holder, or minted before the signer was reclassified), and
    // proves verifyReceipt still rejects it because signedBy resolves to a
    // machine identity. Waivers get two independent guards (MAC + FR-P2
    // re-check); this asserts the FR-P2 one, not the MAC.
    const content = {
      id: 'forged-waiver',
      kind: 'waiver' as const,
      projectId: 'proj-1',
      phase: null,
      ticketId: null,
      validators: [],
      inputTreeHash: computeInputTreeHash(FILES),
      verifyCommand: null,
      verifyExit: null,
      signedBy: 'coding-agent',
    };
    const contentMac = computeReceiptMac(content, TEST_SIGNING_KEY);

    log.db
      .prepare(
        `INSERT INTO receipts
           (id, kind, project_id, phase, ticket_id, validators, input_tree_hash,
            verify_command, verify_exit, signed_by, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        content.id,
        content.kind,
        content.projectId,
        content.phase,
        content.ticketId,
        JSON.stringify(content.validators),
        content.inputTreeHash,
        content.verifyCommand,
        content.verifyExit,
        content.signedBy,
        'null',
        NOW(),
      );
    appendEvent(
      log,
      {
        eventType: 'gate.waived',
        actorId: 'coding-agent',
        ticketId: null,
        payload: { receiptId: content.id, kind: 'waiver', contentMac },
      },
      { now: NOW },
    );

    const result = verifyReceipt(log, 'forged-waiver', {
      inputFiles: FILES,
      requiredValidators: [],
      signingKey: TEST_SIGNING_KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/FR-P2/);
  });

  it('BLUEPRINT §3.2: touching an input file (lock-file equivalent) after minting flips a valid receipt to invalid via hash mismatch', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);

    mintReceipt(
      log,
      {
        id: 'receipt-lock',
        kind: 'gate',
        projectId: 'proj-1',
        validators: [{ name: 'lint', exitCode: 0, gapCount: 0 }],
        inputFiles: FILES,
        actorId: 'human-1',
      },
      { now: NOW, signingKey: TEST_SIGNING_KEY },
    );

    const beforeTouch = verifyReceipt(log, 'receipt-lock', {
      inputFiles: FILES,
      requiredValidators: ['lint'],
      signingKey: TEST_SIGNING_KEY,
    });
    expect(beforeTouch.valid).toBe(true);

    const touchedFiles: ReceiptInputFile[] = FILES.map((f) =>
      f.path === 'pnpm-lock.yaml' ? { ...f, content: 'lockfile-v2-tampered' } : f,
    );
    const afterTouch = verifyReceipt(log, 'receipt-lock', {
      inputFiles: touchedFiles,
      requiredValidators: ['lint'],
      signingKey: TEST_SIGNING_KEY,
    });

    expect(afterTouch.valid).toBe(false);
    expect(afterTouch.reasons.join(' ')).toMatch(/input tree hash mismatch/);
  });

  it('BLUEPRINT §3.2: a receipt whose validator set no longer covers a currently-required validator is stale, even though its input hash still matches', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);

    mintReceipt(
      log,
      {
        id: 'receipt-stale',
        kind: 'gate',
        projectId: 'proj-1',
        validators: [{ name: 'lint', exitCode: 0, gapCount: 0 }],
        inputFiles: FILES,
        actorId: 'human-1',
      },
      { now: NOW, signingKey: TEST_SIGNING_KEY },
    );

    // Gate definition drift: a new validator ("typecheck") became required
    // after this receipt was minted. The input tree is untouched.
    const result = verifyReceipt(log, 'receipt-stale', {
      inputFiles: FILES,
      requiredValidators: ['lint', 'typecheck'],
      signingKey: TEST_SIGNING_KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/validator set is stale/);
    expect(result.reasons.join(' ')).not.toMatch(/input tree hash mismatch/);
  });

  it('FR-P2: a validator with a nonzero exit code does not satisfy currency even if named correctly', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);

    mintReceipt(
      log,
      {
        id: 'receipt-failed-validator',
        kind: 'gate',
        projectId: 'proj-1',
        validators: [{ name: 'lint', exitCode: 1, gapCount: 2 }],
        inputFiles: FILES,
        actorId: 'human-1',
      },
      { now: NOW, signingKey: TEST_SIGNING_KEY },
    );

    const result = verifyReceipt(log, 'receipt-failed-validator', {
      inputFiles: FILES,
      requiredValidators: ['lint'],
      signingKey: TEST_SIGNING_KEY,
    });

    expect(result.valid).toBe(false);
  });

  it('FR-P2: waiver receipts require a signedBy identity', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);

    expect(() =>
      mintReceipt(
        log,
        {
          id: 'waiver-missing-signer',
          kind: 'waiver',
          projectId: 'proj-1',
          validators: [],
          inputFiles: FILES,
          actorId: 'human-1',
        },
        { now: NOW, signingKey: TEST_SIGNING_KEY },
      ),
    ).toThrow(WaiverSignatureRequiredError);
  });

  it('FR-P2/FR-N3: an agent-signed waiver is rejected (kind !== human)', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);

    expect(() =>
      mintReceipt(
        log,
        {
          id: 'waiver-agent-signed',
          kind: 'waiver',
          projectId: 'proj-1',
          validators: [],
          inputFiles: FILES,
          actorId: 'coding-agent',
          signedBy: 'coding-agent',
        },
        { now: NOW, signingKey: TEST_SIGNING_KEY },
      ),
    ).toThrow(AgentWaiverRejectedError);
  });

  it('FR-P2/FR-N3: a human identity whose name matches the agent-name blocklist is rejected (defense in depth)', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);
    createIdentity(
      log,
      { id: 'mislabeled-1', name: 'Claude the reviewer', kind: 'human' },
      { now: NOW },
    );
    expect(DEFAULT_AGENT_NAME_BLOCKLIST).toContain('claude');

    expect(() =>
      mintReceipt(
        log,
        {
          id: 'waiver-mislabeled',
          kind: 'waiver',
          projectId: 'proj-1',
          validators: [],
          inputFiles: FILES,
          actorId: 'human-1',
          signedBy: 'mislabeled-1',
        },
        { now: NOW, signingKey: TEST_SIGNING_KEY },
      ),
    ).toThrow(AgentWaiverRejectedError);
  });

  it('FR-P2: a human-signed waiver is accepted and verifiable', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);

    const waiver = mintReceipt(
      log,
      {
        id: 'waiver-valid',
        kind: 'waiver',
        projectId: 'proj-1',
        validators: [],
        inputFiles: FILES,
        actorId: 'human-1',
        signedBy: 'human-1',
        payload: { reason: 'accepted known risk SW-001' },
      },
      { now: NOW, signingKey: TEST_SIGNING_KEY },
    );

    expect(waiver.signedBy).toBe('human-1');
    const result = verifyReceipt(log, 'waiver-valid', {
      inputFiles: FILES,
      requiredValidators: [],
      signingKey: TEST_SIGNING_KEY,
    });
    expect(result.valid).toBe(true);
  });

  it('C3: a genuinely-minted receipt fails verification under the wrong minting secret (the MAC is what is checked)', async () => {
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    seedIdentities(log);

    mintReceipt(
      log,
      {
        id: 'receipt-wrong-key',
        kind: 'gate',
        projectId: 'proj-1',
        validators: [{ name: 'lint', exitCode: 0, gapCount: 0 }],
        inputFiles: FILES,
        actorId: 'human-1',
      },
      { now: NOW, signingKey: TEST_SIGNING_KEY },
    );

    const result = verifyReceipt(log, 'receipt-wrong-key', {
      inputFiles: FILES,
      requiredValidators: ['lint'],
      signingKey: 'a-different-secret',
    });

    expect(result.valid).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/not minted by a real run/);
  });

  it('computeInputTreeHash is order-independent but content-sensitive', () => {
    const a: ReceiptInputFile[] = [
      { path: 'b.txt', content: '2' },
      { path: 'a.txt', content: '1' },
    ];
    const b: ReceiptInputFile[] = [
      { path: 'a.txt', content: '1' },
      { path: 'b.txt', content: '2' },
    ];
    expect(computeInputTreeHash(a)).toBe(computeInputTreeHash(b));

    const mutated: ReceiptInputFile[] = [
      { path: 'a.txt', content: '1-mutated' },
      { path: 'b.txt', content: '2' },
    ];
    expect(computeInputTreeHash(mutated)).not.toBe(computeInputTreeHash(a));
  });
});
