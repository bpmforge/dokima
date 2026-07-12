/**
 * W1-07 — toy-project E2E: one agent, one ticket, full trust chain.
 *
 * Drives a fixture ticket through the real @shipwright/events + tickets +
 * loop packages (imported by relative path, not `@shipwright/*`: this
 * directory is not a pnpm workspace member and packages/loop's own barrel
 * is still a placeholder pending W3-01 — see the HANDOFF note in
 * plan.json's W1-07 entry) with a fake model at the one boundary BLUEPRINT
 * requires it (the spawned "session" — no network, no real agent CLI,
 * CLAUDE.md law 9): claim -> start -> session (HANDOFF -> real micro-loop ->
 * Completion Manifest) -> out-of-session verify (harbormaster-lite.ts:
 * stat files + re-run verify + check commits, never trusting the manifest
 * itself, FR-H1/SC-02) -> close (structural CloseReceipt + durable
 * HMAC-anchored ReceiptRecord) -> accept by a second identity (maker !=
 * verifier, CLAUDE.md law 5). Every transition appends its own event; the
 * whole log's hash chain verifies at the end.
 *
 * Negative paths: a session that lies about a file it never wrote is
 * refused before `closeTicket` is ever called, with a durable refusal
 * receipt recording why; a self-accept attempt is refused by
 * `@shipwright/tickets` itself, and this harness additionally mints a
 * refusal receipt documenting that too.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  listChainRows,
  listEvents,
  mintReceipt,
  openEventLog,
  verifyChain,
  verifyReceipt,
  type EventLog,
} from '../../packages/events/src/index.js';
import { createTempDbPath, type TempDb } from '../../packages/events/src/test-helpers.js';
import {
  acceptTicket,
  claimTicket,
  closeTicket,
  createTicket,
  getTicket,
  startTicket,
  TicketError,
} from '../../packages/tickets/src/index.js';
import type { Handoff } from '../../packages/loop/src/handoff.js';
import {
  runMicroLoop,
  type MicroLoopCallbacks,
  type MicroLoopItem,
} from '../../packages/loop/src/micro-loop.js';
import { runSession, type SpawnSession } from '../../packages/loop/src/session.js';
import type { CompletionManifest } from '../../packages/loop/src/session-manifest.js';
import {
  mintVerificationReceipt,
  verifyManifestAgainstDisk,
} from './harbormaster-lite.js';
import { createFixtureRepo, git, type FixtureRepo } from './fixture-repo.js';

const PROJECT_ID = 'toy-project';
const TEST_SIGNING_KEY = 'toy-project-e2e-test-minting-secret';
const VERIFY_COMMAND = 'node -e "process.exit(0)"';
const GREETING = 'hello from the toy project\n';

function makeClock(seedMs: number): () => string {
  let t = seedMs;
  return () => {
    const iso = new Date(t).toISOString();
    t += 1000;
    return iso;
  };
}

function handoffFor(ticketId: string): Handoff {
  return {
    role: 'coding-agent',
    mission: 'write the toy greeting file',
    ticket: { id: ticketId, title: 'Toy project fixture ticket' },
    context: 'toy-project fixture — no real repo context needed',
    writeScope: ['src/**'],
    produce: ['src/hello.txt'],
    verify: VERIFY_COMMAND,
  };
}

/**
 * A fake model boundary (CLAUDE.md law 9: no network, no real agent CLI):
 * runs the real `runMicroLoop` for one item (write + self-verify
 * src/hello.txt), commits the result, and returns a Completion Manifest as
 * the session's raw stdout — exactly the contract-tier shape
 * `parseCompletionManifest` expects. `writeFileList` lets the negative-path
 * fixture claim a file it never actually writes.
 */
function fakeSpawn(
  repo: FixtureRepo,
  ticketId: string,
  claimedFiles: string[],
): SpawnSession {
  return async () => {
    const item: MicroLoopItem = {
      id: `${ticketId}-hello`,
      description: 'write src/hello.txt with the toy greeting',
    };
    const callbacks: MicroLoopCallbacks = {
      restateCriterion: () => ({
        checkable: true,
        statement: 'src/hello.txt exists and contains the toy greeting',
      }),
      produce: async () => {
        await fs.writeFile(path.join(repo.repoRoot, 'src', 'hello.txt'), GREETING);
        return { output: 'wrote src/hello.txt' };
      },
      gatherEvidence: async () => {
        const content = await fs.readFile(
          path.join(repo.repoRoot, 'src', 'hello.txt'),
          'utf8',
        );
        return [{ kind: 'read-file', detail: 'src/hello.txt', result: content }];
      },
      selfVerify: ({ evidence }) => {
        const passed = evidence.some((e) => e.result === GREETING);
        return {
          passed,
          gaps: passed
            ? []
            : [
                {
                  id: 'content-mismatch',
                  description: 'src/hello.txt content did not match',
                },
              ],
        };
      },
    };
    const result = await runMicroLoop(item, callbacks);
    if (result.status !== 'DONE') {
      throw new Error(`fixture micro-loop did not reach DONE: ${result.status}`);
    }

    await git(repo.repoRoot, ['add', '--', 'src/hello.txt']);
    await git(repo.repoRoot, ['commit', '-m', 'feat: add hello.txt']);
    const sha = await git(repo.repoRoot, ['rev-parse', 'HEAD']);

    const manifest: CompletionManifest = {
      ticket: ticketId,
      files: claimedFiles,
      verify: { command: VERIFY_COMMAND, exit: 0 },
      commits: [sha],
      evidence: [`micro-loop DONE after ${result.passes.length} pass(es)`],
    };
    return { stdout: JSON.stringify(manifest), stderr: '', exitCode: 0 };
  };
}

interface SeededTicket {
  readonly ticketId: string;
  readonly makerId: string;
}

async function seedTicket(
  log: EventLog,
  now: () => string,
  ticketId: string,
  makerId: string,
): Promise<SeededTicket> {
  createIdentity(log, { id: makerId, name: makerId, kind: 'machine' }, { now });
  createTicket(
    log,
    makerId,
    {
      id: ticketId,
      type: 'task',
      title: 'Toy project fixture ticket',
      lane: 'toy',
      writeScope: ['src/**'],
      verify: VERIFY_COMMAND,
    },
    { now },
  );
  claimTicket(log, { ticketId, actorId: makerId }, { now });
  startTicket(log, { ticketId, actorId: makerId }, { now });
  return { ticketId, makerId };
}

describe('toy-project E2E — full trust chain', () => {
  let temp: TempDb;
  let log: EventLog;
  let repos: FixtureRepo[];

  afterEach(async () => {
    log?.close();
    await temp?.cleanup();
    await Promise.all((repos ?? []).map((repo) => repo.cleanup()));
  });

  it('claim -> session -> micro-loop -> manifest -> out-of-session verify -> close receipt -> accept by a second identity, every transition with its event + receipt', async () => {
    const now = makeClock(Date.parse('2026-07-12T00:00:00.000Z'));
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    repos = [];

    createIdentity(
      log,
      { id: 'harbormaster-1', name: 'Harbormaster', kind: 'machine' },
      { now },
    );
    createIdentity(
      log,
      { id: 'reviewer-1', name: 'Reviewer One', kind: 'machine' },
      { now },
    );
    const { ticketId, makerId } = await seedTicket(log, now, 'TOY-01', 'maker-1');

    const repo = await createFixtureRepo();
    repos.push(repo);
    const baseSha = await git(repo.repoRoot, ['rev-parse', 'HEAD']);

    // session -> micro-loop -> manifest
    const sessionResult = await runSession({
      handoff: handoffFor(ticketId),
      cwd: repo.repoRoot,
      baseRef: baseSha,
      spawn: fakeSpawn(repo, ticketId, ['src/hello.txt']),
    });
    expect(sessionResult.manifestParseTier).toBe('contract');
    expect(sessionResult.scopeViolations).toEqual([]);
    const manifest = sessionResult.manifest;
    if (!manifest) throw new Error('expected a parsed manifest');

    // out-of-session verify (never trusts the manifest directly — SC-02):
    // the canonical verify command comes from the ticket's own state (set by
    // the maker identity at ticket-creation time), never from the manifest.
    const canonicalVerifyCommand = getTicket(log, ticketId)?.verify;
    if (!canonicalVerifyCommand)
      throw new Error('expected ticket to carry a verify command');
    const verification = await verifyManifestAgainstDisk(
      manifest,
      repo.repoRoot,
      canonicalVerifyCommand,
    );
    expect(verification.ok).toBe(true);
    expect(verification.reasons).toEqual([]);

    const closeReceipt = await mintVerificationReceipt({
      id: `receipt-${ticketId}-close`,
      log,
      projectId: PROJECT_ID,
      ticketId,
      actorId: 'harbormaster-1',
      cwd: repo.repoRoot,
      manifest,
      canonicalVerifyCommand,
      verification,
      signingKey: TEST_SIGNING_KEY,
      now,
    });
    expect(closeReceipt.kind).toBe('close');

    const helloContent = await fs.readFile(
      path.join(repo.repoRoot, 'src', 'hello.txt'),
      'utf8',
    );
    const receiptCheck = verifyReceipt(log, closeReceipt.id, {
      signingKey: TEST_SIGNING_KEY,
      inputFiles: [{ path: 'src/hello.txt', content: helloContent }],
      requiredValidators: [
        'file-stat',
        'commit-exists',
        'verify-command-matches-ticket',
        'verify-rerun',
      ],
    });
    expect(receiptCheck.valid).toBe(true);
    expect(receiptCheck.reasons).toEqual([]);

    // close (structural CloseReceipt embedded in the manifest + ticket.closed event)
    const closedTicket = closeTicket(
      log,
      {
        ticketId,
        actorId: makerId,
        files: [...manifest.files],
        verify: {
          command: manifest.verify.command,
          exitCode: verification.actualVerifyExit ?? -1,
        },
        commits: [...manifest.commits],
      },
      { now },
    );
    expect(closedTicket.status).toBe('in_review');
    expect(closedTicket.manifest?.closeReceipt).toBeDefined();

    // accept by a second identity (maker != verifier, CLAUDE.md law 5)
    const acceptedTicket = acceptTicket(
      log,
      { ticketId, actorId: 'reviewer-1' },
      { now },
    );
    expect(acceptedTicket.status).toBe('done');

    // every transition has its event
    const ticketEvents = listEvents(log).filter((e) => e.ticketId === ticketId);
    const eventTypes = ticketEvents.map((e) => e.eventType);
    expect(eventTypes).toEqual([
      'ticket.created',
      'ticket.claimed',
      'ticket.started',
      'gate.receipt_minted', // the out-of-session verify's durable close receipt
      'ticket.closed',
      'ticket.accepted',
    ]);
    expect(ticketEvents.find((e) => e.eventType === 'ticket.claimed')?.actorId).toBe(
      makerId,
    );
    expect(ticketEvents.find((e) => e.eventType === 'ticket.closed')?.actorId).toBe(
      makerId,
    );
    expect(ticketEvents.find((e) => e.eventType === 'ticket.accepted')?.actorId).toBe(
      'reviewer-1',
    );

    // the close transition also carries a durable, anchored receipt
    expect(closeReceipt.ticketId).toBe(ticketId);

    // the whole hash chain still verifies
    const chain = verifyChain(listChainRows(log));
    expect(chain.valid).toBe(true);
  });

  it('negative path: a fabricated manifest (file listed but absent on disk) is refused before close, with a receipt showing why', async () => {
    const now = makeClock(Date.parse('2026-07-12T01:00:00.000Z'));
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    repos = [];

    createIdentity(
      log,
      { id: 'harbormaster-1', name: 'Harbormaster', kind: 'machine' },
      { now },
    );
    const { ticketId, makerId } = await seedTicket(log, now, 'TOY-02', 'maker-2');

    const repo = await createFixtureRepo();
    repos.push(repo);
    const baseSha = await git(repo.repoRoot, ['rev-parse', 'HEAD']);

    // The session actually writes/commits src/hello.txt, but the returned
    // manifest also claims a second file it never touched — a lying/buggy
    // session, exactly the case FR-H1's out-of-session check exists for.
    const sessionResult = await runSession({
      handoff: handoffFor(ticketId),
      cwd: repo.repoRoot,
      baseRef: baseSha,
      spawn: fakeSpawn(repo, ticketId, ['src/hello.txt', 'src/phantom.txt']),
    });
    const manifest = sessionResult.manifest;
    if (!manifest) throw new Error('expected a parsed manifest');
    expect(manifest.files).toContain('src/phantom.txt');

    const canonicalVerifyCommand = getTicket(log, ticketId)?.verify;
    if (!canonicalVerifyCommand)
      throw new Error('expected ticket to carry a verify command');
    const verification = await verifyManifestAgainstDisk(
      manifest,
      repo.repoRoot,
      canonicalVerifyCommand,
    );
    expect(verification.ok).toBe(false);
    expect(verification.missingFiles).toEqual(['src/phantom.txt']);
    expect(verification.reasons.join(' ')).toContain('src/phantom.txt');

    const refusalReceipt = await mintVerificationReceipt({
      id: `receipt-${ticketId}-refused`,
      log,
      projectId: PROJECT_ID,
      ticketId,
      actorId: 'harbormaster-1',
      cwd: repo.repoRoot,
      manifest,
      canonicalVerifyCommand,
      verification,
      signingKey: TEST_SIGNING_KEY,
      now,
    });
    expect(refusalReceipt.kind).toBe('gate');
    const fileStatValidator = refusalReceipt.validators.find(
      (v) => v.name === 'file-stat',
    );
    expect(fileStatValidator?.exitCode).toBe(1);
    expect(fileStatValidator?.gapCount).toBe(1);
    expect((refusalReceipt.payload as { reasons: string[] }).reasons.join(' ')).toContain(
      'src/phantom.txt',
    );

    const helloContent = await fs.readFile(
      path.join(repo.repoRoot, 'src', 'hello.txt'),
      'utf8',
    );
    const receiptCheck = verifyReceipt(log, refusalReceipt.id, {
      signingKey: TEST_SIGNING_KEY,
      // only the file(s) that actually exist on disk were hashed into the
      // receipt at mint time (harbormaster-lite.ts's readExistingFiles) —
      // the phantom file was never real, so it's excluded here too.
      inputFiles: [{ path: 'src/hello.txt', content: helloContent }],
      requiredValidators: [],
    });
    expect(receiptCheck.valid).toBe(true); // the refusal receipt itself is a real, anchored artifact

    // The harness refuses to call closeTicket at all — the fabricated
    // manifest never reaches the tickets package. (closeTicket's own check
    // is structural only — see packages/tickets/src/verbs.ts's docstring —
    // so this out-of-session step is the actual gate.)
    const ticketAfterRefusal = listEvents(log).filter((e) => e.ticketId === ticketId);
    expect(ticketAfterRefusal.map((e) => e.eventType)).toEqual([
      'ticket.created',
      'ticket.claimed',
      'ticket.started',
      'gate.receipt_minted', // the refusal receipt — no ticket.closed follows it
    ]);
    expect(makerId).toBe('maker-2');
  });

  it('negative path: self-accept is refused, receipt shows why', async () => {
    const now = makeClock(Date.parse('2026-07-12T02:00:00.000Z'));
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    repos = [];

    createIdentity(
      log,
      { id: 'harbormaster-1', name: 'Harbormaster', kind: 'machine' },
      { now },
    );
    createIdentity(
      log,
      { id: 'reviewer-1', name: 'Reviewer One', kind: 'machine' },
      { now },
    );
    const { ticketId, makerId } = await seedTicket(log, now, 'TOY-03', 'maker-3');

    const repo = await createFixtureRepo();
    repos.push(repo);
    const baseSha = await git(repo.repoRoot, ['rev-parse', 'HEAD']);

    const sessionResult = await runSession({
      handoff: handoffFor(ticketId),
      cwd: repo.repoRoot,
      baseRef: baseSha,
      spawn: fakeSpawn(repo, ticketId, ['src/hello.txt']),
    });
    const manifest = sessionResult.manifest;
    if (!manifest) throw new Error('expected a parsed manifest');

    const canonicalVerifyCommand = getTicket(log, ticketId)?.verify;
    if (!canonicalVerifyCommand)
      throw new Error('expected ticket to carry a verify command');
    const verification = await verifyManifestAgainstDisk(
      manifest,
      repo.repoRoot,
      canonicalVerifyCommand,
    );
    expect(verification.ok).toBe(true);
    await mintVerificationReceipt({
      id: `receipt-${ticketId}-close`,
      log,
      projectId: PROJECT_ID,
      ticketId,
      actorId: 'harbormaster-1',
      cwd: repo.repoRoot,
      manifest,
      canonicalVerifyCommand,
      verification,
      signingKey: TEST_SIGNING_KEY,
      now,
    });
    closeTicket(
      log,
      {
        ticketId,
        actorId: makerId,
        files: [...manifest.files],
        verify: {
          command: manifest.verify.command,
          exitCode: verification.actualVerifyExit ?? -1,
        },
        commits: [...manifest.commits],
      },
      { now },
    );

    // the owner tries to accept its own work — refused by @shipwright/tickets itself
    let refusal: unknown;
    try {
      acceptTicket(log, { ticketId, actorId: makerId }, { now });
    } catch (err) {
      refusal = err;
    }
    expect(refusal).toBeInstanceOf(TicketError);
    expect((refusal as TicketError).code).toBe('SELF_ACCEPT');

    // the harness mints a durable receipt recording why the refusal happened
    const refusalReceipt = mintReceipt(
      log,
      {
        id: `receipt-${ticketId}-self-accept-refused`,
        kind: 'gate',
        projectId: PROJECT_ID,
        ticketId,
        validators: [{ name: 'maker-verifier-distinct', exitCode: 1, gapCount: 1 }],
        inputFiles: [],
        actorId: 'harbormaster-1',
        payload: {
          refusalCode: (refusal as TicketError).code,
          message: (refusal as TicketError).message,
          attemptedActorId: makerId,
        },
      },
      { signingKey: TEST_SIGNING_KEY, now },
    );
    expect(refusalReceipt.kind).toBe('gate');
    const receiptCheck = verifyReceipt(log, refusalReceipt.id, {
      signingKey: TEST_SIGNING_KEY,
      inputFiles: [],
      requiredValidators: [],
    });
    expect(receiptCheck.valid).toBe(true);

    // accept by the actual second identity still succeeds afterward
    const acceptedTicket = acceptTicket(
      log,
      { ticketId, actorId: 'reviewer-1' },
      { now },
    );
    expect(acceptedTicket.status).toBe('done');

    const chain = verifyChain(listChainRows(log));
    expect(chain.valid).toBe(true);
  });

  it('negative path: a manifest claiming a different verify command than the ticket is refused, and the claimed command is never executed', async () => {
    const now = makeClock(Date.parse('2026-07-12T03:00:00.000Z'));
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    repos = [];

    createIdentity(
      log,
      { id: 'harbormaster-1', name: 'Harbormaster', kind: 'machine' },
      { now },
    );
    const { ticketId } = await seedTicket(log, now, 'TOY-04', 'maker-4');

    const repo = await createFixtureRepo();
    repos.push(repo);
    const baseSha = await git(repo.repoRoot, ['rev-parse', 'HEAD']);

    // A malicious/buggy session that claims a verify command other than the
    // ticket's own canonical one — if this were ever executed instead of
    // compared, it would write `pwned.txt` into the worktree.
    const maliciousCommand =
      "node -e \"require('fs').writeFileSync('pwned.txt', 'pwned')\"";
    const spawn: SpawnSession = async () => {
      await fs.writeFile(path.join(repo.repoRoot, 'src', 'hello.txt'), GREETING);
      await git(repo.repoRoot, ['add', '--', 'src/hello.txt']);
      await git(repo.repoRoot, ['commit', '-m', 'feat: add hello.txt']);
      const sha = await git(repo.repoRoot, ['rev-parse', 'HEAD']);
      const manifest: CompletionManifest = {
        ticket: ticketId,
        files: ['src/hello.txt'],
        verify: { command: maliciousCommand, exit: 0 },
        commits: [sha],
        evidence: ['fabricated evidence'],
      };
      return { stdout: JSON.stringify(manifest), stderr: '', exitCode: 0 };
    };

    const sessionResult = await runSession({
      handoff: handoffFor(ticketId),
      cwd: repo.repoRoot,
      baseRef: baseSha,
      spawn,
    });
    const manifest = sessionResult.manifest;
    if (!manifest) throw new Error('expected a parsed manifest');
    expect(manifest.verify.command).toBe(maliciousCommand);

    const canonicalVerifyCommand = getTicket(log, ticketId)?.verify;
    if (!canonicalVerifyCommand)
      throw new Error('expected ticket to carry a verify command');
    const verification = await verifyManifestAgainstDisk(
      manifest,
      repo.repoRoot,
      canonicalVerifyCommand,
    );

    expect(verification.ok).toBe(false);
    expect(verification.reasons.join(' ')).toContain(maliciousCommand);
    // the claimed (malicious) command was never executed — only the
    // ticket's own canonical command was re-run.
    await expect(fs.access(path.join(repo.repoRoot, 'pwned.txt'))).rejects.toThrow();

    const refusalReceipt = await mintVerificationReceipt({
      id: `receipt-${ticketId}-verify-command-mismatch`,
      log,
      projectId: PROJECT_ID,
      ticketId,
      actorId: 'harbormaster-1',
      cwd: repo.repoRoot,
      manifest,
      canonicalVerifyCommand,
      verification,
      signingKey: TEST_SIGNING_KEY,
      now,
    });
    expect(refusalReceipt.kind).toBe('gate');
    const commandValidator = refusalReceipt.validators.find(
      (v) => v.name === 'verify-command-matches-ticket',
    );
    expect(commandValidator?.exitCode).toBe(1);
    expect(
      (refusalReceipt.payload as { claimedVerifyCommand: string }).claimedVerifyCommand,
    ).toBe(maliciousCommand);
  });

  it('negative path: a manifest claiming a path outside the worktree (../ traversal) is refused and its content is never read into the receipt', async () => {
    const now = makeClock(Date.parse('2026-07-12T04:00:00.000Z'));
    temp = await createTempDbPath();
    log = openEventLog(temp.dbPath);
    repos = [];

    createIdentity(
      log,
      { id: 'harbormaster-1', name: 'Harbormaster', kind: 'machine' },
      { now },
    );
    const { ticketId } = await seedTicket(log, now, 'TOY-05', 'maker-5');

    const repo = await createFixtureRepo();
    repos.push(repo);
    const baseSha = await git(repo.repoRoot, ['rev-parse', 'HEAD']);

    // Plant a "secret" OUTSIDE the worktree, reachable only via `..`, standing
    // in for e.g. ../../.env or ~/.ssh/id_rsa. A malicious/compromised session
    // then claims it in the manifest, trying to get harbormaster-lite to stat
    // (confirm its existence) and read (leak its content into the durable,
    // HMAC-anchored event log — law #8) a file it has no business touching.
    const SECRET = 'TOP-SECRET-do-not-leak-into-the-event-log\n';
    const sentinelName = `${path.basename(repo.repoRoot)}-secret.txt`;
    const sentinelPath = path.join(path.dirname(repo.repoRoot), sentinelName);
    await fs.writeFile(sentinelPath, SECRET);
    const traversalClaim = `../${sentinelName}`;

    try {
      const sessionResult = await runSession({
        handoff: handoffFor(ticketId),
        cwd: repo.repoRoot,
        baseRef: baseSha,
        spawn: fakeSpawn(repo, ticketId, ['src/hello.txt', traversalClaim]),
      });
      const manifest = sessionResult.manifest;
      if (!manifest) throw new Error('expected a parsed manifest');
      expect(manifest.files).toContain(traversalClaim);

      const canonicalVerifyCommand = getTicket(log, ticketId)?.verify;
      if (!canonicalVerifyCommand)
        throw new Error('expected ticket to carry a verify command');
      const verification = await verifyManifestAgainstDisk(
        manifest,
        repo.repoRoot,
        canonicalVerifyCommand,
      );

      // The traversal entry is refused up front — treated exactly like a
      // missing file (never stat'd as present), so the manifest cannot even
      // confirm the secret exists.
      expect(verification.ok).toBe(false);
      expect(verification.missingFiles).toContain(traversalClaim);
      expect(verification.reasons.join(' ')).toContain(traversalClaim);

      const refusalReceipt = await mintVerificationReceipt({
        id: `receipt-${ticketId}-traversal-refused`,
        log,
        projectId: PROJECT_ID,
        ticketId,
        actorId: 'harbormaster-1',
        cwd: repo.repoRoot,
        manifest,
        canonicalVerifyCommand,
        verification,
        signingKey: TEST_SIGNING_KEY,
        now,
      });
      expect(refusalReceipt.kind).toBe('gate');

      // The secret's content is never read into the receipt. Proof: the
      // receipt's input-tree hash matches ONLY the in-worktree file — if the
      // sentinel had been read, verifyReceipt with just src/hello.txt would
      // fail on a tree-hash mismatch.
      const helloContent = await fs.readFile(
        path.join(repo.repoRoot, 'src', 'hello.txt'),
        'utf8',
      );
      const receiptCheck = verifyReceipt(log, refusalReceipt.id, {
        signingKey: TEST_SIGNING_KEY,
        inputFiles: [{ path: 'src/hello.txt', content: helloContent }],
        requiredValidators: [],
      });
      expect(receiptCheck.valid).toBe(true);
      // Belt and suspenders: the secret's bytes appear nowhere in the receipt.
      expect(JSON.stringify(refusalReceipt)).not.toContain('TOP-SECRET');

      // The fabricated manifest never reaches closeTicket — the out-of-session
      // gate refuses it, leaving only the refusal receipt behind.
      const ticketEvents = listEvents(log).filter((e) => e.ticketId === ticketId);
      expect(ticketEvents.map((e) => e.eventType)).toEqual([
        'ticket.created',
        'ticket.claimed',
        'ticket.started',
        'gate.receipt_minted',
      ]);

      const chain = verifyChain(listChainRows(log));
      expect(chain.valid).toBe(true);
    } finally {
      await fs.rm(sentinelPath, { force: true });
    }
  });

  it('refuses a manifest file that symlink-escapes the worktree (SC-02)', async () => {
    // A session can create a symlink *inside* its own write-scope that points
    // outside it (e.g. src/leak.txt -> ~/.ssh/id_rsa). Lexical containment
    // passes; only real-path resolution catches it. The escaped file must be
    // treated as missing — never read, never hashed into the receipt (law #8).
    const repo = await createFixtureRepo();
    const root = repo.repoRoot;
    const secret = path.join(root, '..', `secret-${path.basename(root)}.txt`);
    try {
      await fs.writeFile(path.join(root, 'src', 'ok.txt'), 'legit\n');
      await fs.writeFile(secret, 'TOP SECRET\n');
      await fs.symlink(secret, path.join(root, 'src', 'leak.txt'));
      const manifest: CompletionManifest = {
        ticket: 'W-TEST',
        files: ['src/ok.txt', 'src/leak.txt'],
        verify: { command: 'pnpm test', exit: 0 },
        commits: [],
        evidence: [],
      };
      const v = await verifyManifestAgainstDisk(manifest, root, 'pnpm test');
      expect(v.ok).toBe(false);
      expect(v.missingFiles).toContain('src/leak.txt'); // symlink escape rejected
      expect(v.missingFiles).not.toContain('src/ok.txt'); // real in-scope file still accepted
    } finally {
      await repo.cleanup();
      await fs.rm(secret, { force: true }).catch(() => {});
    }
  });
});
