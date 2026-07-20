import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  getReceipt,
  openEventLog,
  verifyReceipt,
  type EventLog,
} from '@shipwright/events';
import { createWorktree, git, type WorktreeHandle } from '@shipwright/git';
import {
  claimTicket,
  createTicket,
  getTicket,
  startTicket,
  type CreateTicketInput,
  type Ticket,
} from '@shipwright/tickets';
import {
  classifySecretsGaps,
  parseGapLocation,
  runCloseGate,
  type CompletionManifest,
} from './loop-gates.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_VALIDATORS_DIR = path.resolve(
  HERE,
  '..',
  '..',
  '..',
  'content',
  'validators',
);

const TEST_SIGNING_KEY = 'test-close-gate-signing-key';
const PROJECT_ID = 'proj-w3-01b';
const NOW = () => '2026-07-16T00:00:00.000Z';

/** A `sk-`-shaped string matching secrets-scan.sh's openai-style-key pattern (`sk-[A-Za-z0-9_-]{16,}`) — a fixture literal, never a real credential. */
const PLANTED_SECRET = 'sk-plantedFAKEvalueFORTESTS1234567890';

interface Fixture {
  repoRoot: string;
  dbDir: string;
  log: EventLog;
  worktree: WorktreeHandle;
  cleanup: () => Promise<void>;
}

interface SetupOptions {
  ticket?: Partial<CreateTicketInput>;
  /** Extra commits landed on `main` BEFORE the ticket worktree branches — simulates pre-existing repo content this session never touches. */
  seedMain?: (repoRoot: string) => Promise<void>;
}

async function setupFixture(opts: SetupOptions = {}): Promise<Fixture> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-gates-repo-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
  await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);

  if (opts.seedMain) await opts.seedMain(repoRoot);

  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-gates-db-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });

  createTicket(log, 'worker-1', {
    id: 'W9-01',
    type: 'task',
    title: 'Ticket W9-01',
    lane: 'core',
    writeScope: ['packages/example/**'],
    verify: 'true',
    ...opts.ticket,
  });
  claimTicket(log, { ticketId: 'W9-01', actorId: 'worker-1' });
  startTicket(log, { ticketId: 'W9-01', actorId: 'worker-1' });

  const worktree = await createWorktree({
    repoRoot,
    ticketId: 'W9-01',
    slug: 'ticket-w9-01',
    baseRef: 'main',
  });

  return {
    repoRoot,
    dbDir,
    log,
    worktree,
    cleanup: async () => {
      log.close();
      await fs.rm(repoRoot, { recursive: true, force: true });
      await fs.rm(dbDir, { recursive: true, force: true });
    },
  };
}

/** Writes and commits a file inside the ticket worktree, returning the new commit sha. */
async function commitFile(
  worktree: WorktreeHandle,
  relPath: string,
  content: string,
  message: string,
): Promise<string> {
  const filePath = path.join(worktree.path, relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  await git(worktree.path, ['add', '--', relPath]);
  await git(worktree.path, ['commit', '-m', message]);
  const { stdout } = await git(worktree.path, ['rev-parse', 'HEAD']);
  return stdout.trim();
}

function buildManifest(overrides: Partial<CompletionManifest> = {}): CompletionManifest {
  return {
    ticket: 'W9-01',
    files: [],
    verify: { command: 'true', exit: 0 },
    commits: [],
    evidence: [],
    ...overrides,
  };
}

function requireTicket(log: EventLog, ticketId: string): Ticket {
  const ticket = getTicket(log, ticketId);
  if (!ticket) throw new Error(`ticket ${ticketId} not found`);
  return ticket;
}

describe('runCloseGate', () => {
  let fixture: Fixture | undefined;
  let extraTempDirs: string[] = [];

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
    await Promise.all(
      extraTempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    extraTempDirs = [];
  });

  it('closes the ticket and mints a valid, verifiable close receipt when everything checks out', async () => {
    fixture = await setupFixture();
    const { log, worktree } = fixture;

    await commitFile(
      worktree,
      'packages/example/file.ts',
      'export const x = 1;\n',
      'feat: add file',
    );

    const manifest = buildManifest({
      files: ['packages/example/file.ts'],
      // Deliberately a fabricated sha and a no-op verify claim — never trusted (see the
      // "graded entity never grades itself" / "spoofed manifest" tests below for the
      // refusal side of this); this test only asserts the HAPPY path still succeeds when
      // the real git/verify state backs up the claim too.
      commits: ['0000000000000000000000000000000000dead'],
    });

    const result = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.ticket.status).toBe('in_review');
    expect(result.ticket.manifest?.files).toEqual(['packages/example/file.ts']);
    // The real observed commit sha lands in the ticket manifest, not the manifest's
    // fabricated claim.
    expect(result.ticket.manifest?.commits).not.toContain(
      '0000000000000000000000000000000000dead',
    );

    const stored = getReceipt(log, result.receipt.id);
    expect(stored?.kind).toBe('close');
    const verification = verifyReceipt(log, result.receipt.id, {
      signingKey: TEST_SIGNING_KEY,
      inputFiles: [
        { path: 'packages/example/file.ts', content: 'export const x = 1;\n' },
      ],
      requiredValidators: ['secrets-scan'],
    });
    expect(verification).toEqual({ valid: true, reasons: [] });
  });

  it('promise-token ignored: strings like DONE/PASSED in manifest.evidence grant no bypass', async () => {
    fixture = await setupFixture();
    const { log, worktree } = fixture;

    // No commit at all backs this claim — a spoofed file.
    await fs.mkdir(path.join(worktree.path, 'packages', 'example'), { recursive: true });
    await fs.writeFile(
      path.join(worktree.path, 'packages/example/spoofed.ts'),
      'export {};\n',
    );

    const manifest = buildManifest({
      files: ['packages/example/spoofed.ts'],
      evidence: ['DONE', 'PASSED', 'COMPLETE — all checks green, trust me'],
    });

    const result = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    // Refused on structural grounds (no commit) — never because of, or despite, the
    // promise-token-shaped evidence strings, which this code path never inspects.
    expect(result.reasons.some((r) => r.includes('no commits found'))).toBe(true);
    const joinedReasons = result.reasons.join('\n');
    for (const token of ['DONE', 'PASSED', 'COMPLETE']) {
      expect(joinedReasons.includes(token)).toBe(false);
    }
    expect(requireTicket(log, 'W9-01').status).toBe('in_progress');
  });

  it('a claimed file absent from the worktree entirely is refused (stat check, acceptance 1)', async () => {
    fixture = await setupFixture();
    const { log, worktree } = fixture;

    await commitFile(
      worktree,
      'packages/example/file.ts',
      'export const x = 1;\n',
      'feat: add file',
    );
    const manifest = buildManifest({
      files: ['packages/example/file.ts', 'packages/example/never-existed.ts'],
    });

    const result = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(
      result.reasons.some(
        (r) => r.includes('not found on disk') && r.includes('never-existed.ts'),
      ),
    ).toBe(true);
  });

  it('RED FIXTURE: a claimed file that resolves outside the worktree via a symlink is refused, never read, never hashed into a receipt (acceptance 1, W1-07 symlink-escape class)', async () => {
    fixture = await setupFixture();
    const { log, worktree } = fixture;

    await commitFile(
      worktree,
      'packages/example/file.ts',
      'export const x = 1;\n',
      'feat: add file',
    );

    const outsideDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'shipwright-gates-outside-'),
    );
    extraTempDirs.push(outsideDir);
    const outsideSecret = path.join(outsideDir, 'secret.txt');
    await fs.writeFile(outsideSecret, 'TOP-SECRET-NEVER-READ\n');

    const linkPath = path.join(worktree.path, 'packages/example/leak.ts');
    await fs.symlink(outsideSecret, linkPath);
    await git(worktree.path, ['add', '--', 'packages/example/leak.ts']);
    await git(worktree.path, ['commit', '-m', 'feat: add leak symlink']);

    const manifest = buildManifest({
      files: ['packages/example/file.ts', 'packages/example/leak.ts'],
    });

    const result = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok)
      throw new Error('expected refusal (this fixture must FAIL verification)');
    expect(
      result.reasons.some((r) => r.includes('symlink-escape') && r.includes('leak.ts')),
    ).toBe(true);
    // The escaping file's content was never read into a reason string, a
    // manifest echo, or (by construction — the reasons check short-circuits
    // before the inputFiles/mintReceipt step) a receipt.
    const joinedReasons = result.reasons.join('\n');
    expect(joinedReasons.includes('TOP-SECRET-NEVER-READ')).toBe(false);
    expect(requireTicket(log, 'W9-01').status).toBe('in_progress');
  });

  it("RED FIXTURE (TOCTOU): a claimed file swapped for an escaping symlink by the ticket's own verify command, after the initial check, is still refused at receipt-read time and never hashed into a receipt (acceptance 1/3, W1-07 symlink-escape class)", async () => {
    const outsideDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'shipwright-gates-outside-'),
    );
    extraTempDirs.push(outsideDir);
    const outsideSecret = path.join(outsideDir, 'secret.txt');
    await fs.writeFile(outsideSecret, 'TOP-SECRET-NEVER-READ\n');

    // The TICKET's OWN verify command — real code committed by the (untrusted,
    // already-exited) agent session — swaps the claimed file for a symlink
    // pointing outside the worktree AFTER classifyManifestFiles's initial
    // check has already run and passed on the original, honest file.
    fixture = await setupFixture({
      ticket: {
        verify: `rm -f packages/example/file.ts && ln -s ${outsideSecret} packages/example/file.ts`,
      },
    });
    const { log, worktree } = fixture;

    await commitFile(
      worktree,
      'packages/example/file.ts',
      'export const x = 1;\n',
      'feat: add file',
    );

    const manifest = buildManifest({ files: ['packages/example/file.ts'] });

    const result = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok)
      throw new Error('expected refusal (TOCTOU symlink-escape must FAIL verification)');
    expect(
      result.reasons.some((r) => r.includes('symlink-escape') && r.includes('file.ts')),
    ).toBe(true);
    // Content behind the post-check symlink swap was never read into a
    // reason string, a manifest echo, or a receipt.
    const joinedReasons = result.reasons.join('\n');
    expect(joinedReasons.includes('TOP-SECRET-NEVER-READ')).toBe(false);
    expect(requireTicket(log, 'W9-01').status).toBe('in_progress');
  });

  it('spoofed manifest fails: a claimed file that exists on disk but was never committed is refused (R-F4)', async () => {
    fixture = await setupFixture();
    const { log, worktree } = fixture;

    // A real commit lands, but NOT for the file the manifest claims.
    await commitFile(
      worktree,
      'packages/example/real.ts',
      'export const real = true;\n',
      'feat: real file',
    );
    await fs.writeFile(
      path.join(worktree.path, 'packages/example/uncommitted.ts'),
      'export {};\n',
    );

    const manifest = buildManifest({ files: ['packages/example/uncommitted.ts'] });

    const result = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.reasons.some((r) => r.includes('not touched by any commit'))).toBe(
      true,
    );
  });

  it("graded entity never grades itself: the ticket's real verify is re-run, ignoring the manifest's claimed command/exit", async () => {
    fixture = await setupFixture({ ticket: { verify: 'exit 1' } });
    const { log, worktree } = fixture;

    await commitFile(
      worktree,
      'packages/example/file.ts',
      'export const x = 1;\n',
      'feat: add file',
    );

    const manifest = buildManifest({
      files: ['packages/example/file.ts'],
      // The session claims its own no-op command passed — never trusted.
      verify: { command: 'true', exit: 0 },
    });

    const result = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.reasons.some((r) => r.includes('verify re-run failed'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('exit 1'))).toBe(true);
  });

  it('R-G2 (inert until W7-01): a memory-eligible role with no memory_written[] is refused only when opted in', async () => {
    fixture = await setupFixture();
    const { log, worktree } = fixture;

    await commitFile(
      worktree,
      'packages/example/file.ts',
      'export const x = 1;\n',
      'feat: add file',
    );
    const manifest = buildManifest({ files: ['packages/example/file.ts'] });

    const refused = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
      role: 'memory-agent',
      memoryEligibleRoles: ['memory-agent'],
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('expected refusal');
    expect(refused.reasons.some((r) => r.includes('memory_written'))).toBe(true);

    // Same manifest, no role opt-in: inert today (W7-01 hasn't landed), so it succeeds.
    const succeeded = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });
    expect(succeeded.ok).toBe(true);
  });

  it('secrets-scan (SC-06): a NEW planted secret inside the diff blocks close via the real gate path', async () => {
    fixture = await setupFixture();
    const { log, worktree } = fixture;

    await commitFile(
      worktree,
      'packages/example/config.ts',
      `export const apiKey = "${PLANTED_SECRET}";\n`,
      'feat: add config (oops)',
    );
    const manifest = buildManifest({ files: ['packages/example/config.ts'] });

    const result = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.reasons.some((r) => r.includes('secrets-scan'))).toBe(true);
    expect(requireTicket(log, 'W9-01').status).toBe('in_progress');
  });

  it('D-014/L-28 shadow-calibration: a pre-existing secret in a file this session never touched does not block close', async () => {
    fixture = await setupFixture({
      seedMain: async (repoRoot) => {
        await fs.mkdir(path.join(repoRoot, 'packages', 'legacy'), { recursive: true });
        await fs.writeFile(
          path.join(repoRoot, 'packages/legacy/pre-existing.md'),
          `Pre-existing fixture doc, never touched by this ticket: ${PLANTED_SECRET}\n`,
        );
        await git(repoRoot, ['add', '--', 'packages/legacy/pre-existing.md']);
        await git(repoRoot, ['commit', '-m', 'chore: pre-existing fixture content']);
      },
    });
    const { log, worktree } = fixture;

    await commitFile(
      worktree,
      'packages/example/file.ts',
      'export const x = 1;\n',
      'feat: add unrelated file',
    );
    const manifest = buildManifest({ files: ['packages/example/file.ts'] });

    const result = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    const payload = result.receipt.payload as {
      secretsScan: { raw: number; effective: number };
    };
    // Raw is never hidden (D-014) even though it didn't gate.
    expect(payload.secretsScan.raw).toBeGreaterThan(0);
    expect(payload.secretsScan.effective).toBe(0);
  });

  it('SECURITY (fail-closed, CRITICAL): a secrets-scan that exits 2 (forced timeout) blocks close with no receipt, exactly like a real planted-secret hit', async () => {
    fixture = await setupFixture();
    const { log, worktree } = fixture;

    // A validator pack fixture whose "secrets-scan" entry hangs well past the
    // timeout — runValidator's 0/1/2 contract normalizes this to exitCode 2
    // (timeout), NOT a clean 0. Before this ticket's fix, loop-gates.ts's
    // effectiveValidatorResults map called classifySecretsGaps() unconditionally,
    // which would parse the synthetic "exceeded ...ms and was killed" gap detail
    // (not file:line shaped), find zero matches in changedPaths, and reclassify
    // the whole result as a false-clean exitCode 0 — sailing a hung/crashed
    // scanner straight through to a minted close receipt. This proves that no
    // longer happens.
    const fixtureContentDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'shipwright-gates-fake-validators-'),
    );
    extraTempDirs.push(fixtureContentDir);
    await fs.writeFile(
      path.join(fixtureContentDir, 'secrets-scan.sh'),
      '#!/bin/bash\nsleep 5\necho \'{"validator":"secrets-scan","gaps":0,"exit":0}\'\n',
    );
    // This fixture's whole point is isolating the secrets-scan timeout path —
    // a stub keeps the OTHER required validator (validate-remote-parity) out
    // of the way instead of failing pack selection against this custom dir.
    await fs.writeFile(
      path.join(fixtureContentDir, 'validate-remote-parity.sh'),
      '#!/bin/bash\necho \'{"validator":"validate-remote-parity","gaps":0,"exit":0}\'\n',
    );

    await commitFile(
      worktree,
      'packages/example/file.ts',
      'export const x = 1;\n',
      'feat: add file',
    );
    const manifest = buildManifest({ files: ['packages/example/file.ts'] });

    const result = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: fixtureContentDir,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
      validatorTimeoutMs: 100,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(
      result.reasons.some((r) => r.includes('secrets-scan') && r.includes('exit 2')),
    ).toBe(true);
    // No receipt minted, ticket state never advanced past in_progress — same
    // "no close receipt => failure comment, never forward progress" contract
    // as every other refusal path.
    expect(requireTicket(log, 'W9-01').status).toBe('in_progress');
  });

  it('validate-remote-parity (wired, amplifier hole 11): a diverged remote-tracking ref blocks close via the real gate path, not merely a warning', async () => {
    fixture = await setupFixture();
    const { log, worktree } = fixture;

    const bareRemote = await fs.mkdtemp(
      path.join(os.tmpdir(), 'shipwright-gates-remote-'),
    );
    extraTempDirs.push(bareRemote);
    await git(bareRemote, ['init', '--bare', '-b', 'main']);
    await git(worktree.path, ['remote', 'add', 'origin', bareRemote]);
    // Establishes a cached tracking ref at the branch's CURRENT tip (the
    // fork point, before this ticket's own commit lands).
    await git(worktree.path, ['push', 'origin', worktree.branch]);

    // Advances local HEAD past what's pushed — the tracking ref is now
    // stale, real divergence (never just an absent ref).
    await commitFile(
      worktree,
      'packages/example/file.ts',
      'export const x = 1;\n',
      'feat: add file',
    );
    const manifest = buildManifest({ files: ['packages/example/file.ts'] });

    const result = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal (diverged remote must block close)');
    expect(result.reasons.some((r) => r.includes('validate-remote-parity'))).toBe(true);
    expect(requireTicket(log, 'W9-01').status).toBe('in_progress');
  });

  it('validate-remote-parity (LOCAL-FIRST, Law 9/C-1): a remote configured but never pushed (no cached tracking ref) does NOT block close', async () => {
    fixture = await setupFixture();
    const { log, worktree } = fixture;

    const bareRemote = await fs.mkdtemp(
      path.join(os.tmpdir(), 'shipwright-gates-remote-'),
    );
    extraTempDirs.push(bareRemote);
    await git(bareRemote, ['init', '--bare', '-b', 'main']);
    // Configured but deliberately never pushed — the normal offline / fresh
    // branch case (this project's own dual-remote setup, verified empirically
    // in earlier conductor notes: 2 remotes, 0 tracking refs).
    await git(worktree.path, ['remote', 'add', 'origin', bareRemote]);

    await commitFile(
      worktree,
      'packages/example/file.ts',
      'export const x = 1;\n',
      'feat: add file',
    );
    const manifest = buildManifest({ files: ['packages/example/file.ts'] });

    const result = await runCloseGate({
      log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      ticket: requireTicket(log, 'W9-01'),
      worktree,
      manifest,
      baseRef: 'main',
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok)
      throw new Error('expected success (no cached tracking ref must never gap)');
  });
});

describe('parseGapLocation', () => {
  it('parses the standard "<relfile>:<lineno> — <masked>" shape', () => {
    expect(
      parseGapLocation('packages/example/config.ts:12 — sk-p...REDACTED(37 chars)'),
    ).toEqual({ file: 'packages/example/config.ts', line: 12 });
  });

  it('guards against a colon inside the file path (splits on the LAST :<digits>, not the first colon)', () => {
    expect(
      parseGapLocation('weird:dir/od:d:file.ts:42 — sk-p...REDACTED(37 chars)'),
    ).toEqual({
      file: 'weird:dir/od:d:file.ts',
      line: 42,
    });
  });

  it('returns null for a detail with no recognizable em-dash separator', () => {
    expect(parseGapLocation('not the expected shape at all')).toEqual({
      file: 'not the expected shape at all',
      line: null,
    });
  });
});

describe('classifySecretsGaps', () => {
  it('effective gaps are only those whose file is in the changed-paths set', () => {
    const result = {
      name: 'secrets-scan',
      exitCode: 1,
      gapCount: 2,
      gaps: [
        {
          category: 'openai-style-key',
          detail: 'packages/touched.ts:1 — sk-a...REDACTED(20 chars)',
        },
        {
          category: 'openai-style-key',
          detail: 'packages/untouched.ts:1 — sk-b...REDACTED(20 chars)',
        },
      ],
      stdout: '',
      stderr: '',
      durationMs: 1,
      timedOut: false,
    };
    const summary = classifySecretsGaps(result, new Set(['packages/touched.ts']));
    expect(summary).toEqual({
      raw: 2,
      effective: 1,
      suppressed: 1,
      effectiveGaps: [result.gaps[0]],
    });
  });
});
