import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  claimTicket,
  createTicket,
  getTicket,
  startTicket,
  type CreateTicketInput,
} from '@shipwright/tickets';
import {
  createIdentity,
  listEvents,
  mintReceipt,
  openEventLog,
  type EventLog,
} from '@shipwright/events';
import { createWorktree, git, type WorktreeHandle } from '@shipwright/git';
import { checkClaimedTicket, resumeProject } from './resume.js';

const NOW = () => '2026-07-18T00:00:00.000Z';
const TEST_SIGNING_KEY = 'test-resume-signing-key';
const PROJECT_ID = 'proj-w3-03';

interface Fixture {
  repoRoot: string;
  dbDir: string;
  log: EventLog;
  cleanup: () => Promise<void>;
}

async function setupFixture(): Promise<Fixture> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-resume-repo-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
  await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);

  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-resume-db-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  // Separate identities per ticket: WIP=1 per actor (tickets/verbs.ts) means
  // one worker cannot own two claimed/in_progress tickets at once, and this
  // fixture builds multi-ticket batches.
  for (const id of ['worker-1', 'worker-2', 'worker-3']) {
    createIdentity(log, { id, name: id, kind: 'machine' }, { now: NOW });
  }

  return {
    repoRoot,
    dbDir,
    log,
    cleanup: async () => {
      log.close();
      await fs.rm(repoRoot, { recursive: true, force: true });
      await fs.rm(dbDir, { recursive: true, force: true });
    },
  };
}

async function claimedTicketWithReceipt(
  fixture: Fixture,
  ticketId: string,
  fileContent: string,
  overrides: Partial<CreateTicketInput> = {},
  actorId = 'worker-1',
): Promise<{ worktree: WorktreeHandle; filePath: string }> {
  const { log, repoRoot } = fixture;
  createTicket(log, actorId, {
    id: ticketId,
    type: 'task',
    title: `Ticket ${ticketId}`,
    lane: 'core',
    writeScope: ['packages/example/**'],
    verify: 'true',
    ...overrides,
  });
  claimTicket(log, { ticketId, actorId });
  startTicket(log, { ticketId, actorId });

  const worktree = await createWorktree({
    repoRoot,
    ticketId,
    slug: `ticket-${ticketId}`,
    baseRef: 'main',
  });

  const relPath = 'packages/example/file.ts';
  const filePath = path.join(worktree.path, relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, fileContent);
  await git(worktree.path, ['add', '--', relPath]);
  await git(worktree.path, ['commit', '-m', 'feat: add file']);
  const { stdout } = await git(worktree.path, ['rev-parse', 'HEAD']);
  const commitSha = stdout.trim();

  mintReceipt(
    log,
    {
      id: `receipt-${ticketId}`,
      kind: 'close',
      projectId: PROJECT_ID,
      ticketId,
      validators: [{ name: 'secrets-scan', exitCode: 0, gapCount: 0 }],
      inputFiles: [{ path: relPath, content: fileContent }],
      verifyCommand: 'true',
      verifyExit: 0,
      actorId,
      payload: { commits: [commitSha], files: [relPath], evidence: [] },
    },
    { signingKey: TEST_SIGNING_KEY, now: NOW },
  );

  return { worktree, filePath };
}

describe('resumeProject (FR-H3) — two-phase, all-or-nothing', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('SECURITY red fixture: a batch whose LAST ticket has drift leaves ZERO ticket.closed events for the earlier valid tickets', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;

    await claimedTicketWithReceipt(
      fixture,
      'W9-01',
      'export const a = 1;\n',
      {},
      'worker-1',
    );
    await claimedTicketWithReceipt(
      fixture,
      'W9-02',
      'export const b = 2;\n',
      {},
      'worker-2',
    );
    const { filePath: driftedFile } = await claimedTicketWithReceipt(
      fixture,
      'W9-03',
      'export const c = 3;\n',
      {},
      'worker-3',
    );

    // Tamper AFTER the receipt minted: someone edited the artifact on disk
    // (UC-11 A1) — the receipt's input-tree hash no longer matches.
    await fs.writeFile(driftedFile, 'export const c = 999; // tampered\n');

    const result = await resumeProject({
      log,
      repoRoot,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected drift refusal');
    expect(result.driftReport).toHaveLength(1);
    expect(result.driftReport[0]?.ticketId).toBe('W9-03');
    expect(result.driftReport[0]?.reasons.join(' ')).toMatch(/input tree hash mismatch/);

    // The critical assertion: ZERO ticket.closed events anywhere in the log,
    // even for W9-01/W9-02 whose receipts were perfectly valid.
    const closedEvents = listEvents(log).filter((e) => e.eventType === 'ticket.closed');
    expect(closedEvents).toHaveLength(0);

    expect(getTicket(log, 'W9-01')?.status).toBe('in_progress');
    expect(getTicket(log, 'W9-02')?.status).toBe('in_progress');
    expect(getTicket(log, 'W9-03')?.status).toBe('in_progress');
  });

  it('all-valid batch: every claimed-but-unclosed ticket with a valid receipt is closed, none redone', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;

    await claimedTicketWithReceipt(
      fixture,
      'W9-01',
      'export const a = 1;\n',
      {},
      'worker-1',
    );
    await claimedTicketWithReceipt(
      fixture,
      'W9-02',
      'export const b = 2;\n',
      {},
      'worker-2',
    );

    const result = await resumeProject({
      log,
      repoRoot,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.closed.map((t) => t.id).sort()).toEqual(['W9-01', 'W9-02']);
    expect(result.skipped).toEqual([]);

    expect(getTicket(log, 'W9-01')?.status).toBe('in_review');
    expect(getTicket(log, 'W9-02')?.status).toBe('in_review');
    const closedEvents = listEvents(log).filter((e) => e.eventType === 'ticket.closed');
    expect(closedEvents).toHaveLength(2);
  });

  it('a claimed ticket with no close receipt at all is left untouched (UC-11 "ticket B")', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;

    createTicket(log, 'worker-1', {
      id: 'W9-05',
      type: 'task',
      title: 'Ticket W9-05',
      lane: 'core',
      writeScope: ['packages/example/**'],
      verify: 'true',
    });
    claimTicket(log, { ticketId: 'W9-05', actorId: 'worker-1' });
    startTicket(log, { ticketId: 'W9-05', actorId: 'worker-1' });

    const result = await resumeProject({
      log,
      repoRoot,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.closed).toEqual([]);
    expect(result.skipped).toEqual(['W9-05']);
    expect(getTicket(log, 'W9-05')?.status).toBe('in_progress');
  });

  it('checkClaimedTicket alone: never calls closeTicket, never appends an event', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;

    await claimedTicketWithReceipt(fixture, 'W9-01', 'export const a = 1;\n');
    const before = listEvents(log).length;
    const ticket = getTicket(log, 'W9-01');
    if (!ticket) throw new Error('fixture ticket missing');

    const check = await checkClaimedTicket(log, ticket, {
      repoRoot,
      signingKey: TEST_SIGNING_KEY,
    });

    expect(check.outcome).toBe('valid');
    expect(listEvents(log).length).toBe(before);
    expect(getTicket(log, 'W9-01')?.status).toBe('in_progress');
  });

  it('drift: a claimed file the receipt declares is missing from disk entirely', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;

    const { filePath } = await claimedTicketWithReceipt(
      fixture,
      'W9-01',
      'export const a = 1;\n',
    );
    await fs.rm(filePath);

    const result = await resumeProject({
      log,
      repoRoot,
      signingKey: TEST_SIGNING_KEY,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected drift refusal');
    expect(result.driftReport[0]?.reasons.join(' ')).toMatch(/no longer present on disk/);
  });

  it('drift: wrong signing key means the anchor MAC cannot be reproduced (forged/edited receipt scenario)', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;

    await claimedTicketWithReceipt(fixture, 'W9-01', 'export const a = 1;\n');

    const result = await resumeProject({
      log,
      repoRoot,
      signingKey: 'not-the-real-key',
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected drift refusal');
    expect(result.driftReport[0]?.reasons.join(' ')).toMatch(/anchoring/);
  });
});
