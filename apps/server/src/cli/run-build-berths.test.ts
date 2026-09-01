/**
 * cli/run-build-berths.test.ts — P6-11: the berths engine honors
 * `landing: 'per-feature'` with the SAME park + idle-time feature sweep the
 * sequential loop applies. Red provenance: before P6-11 the berths path
 * silently landed per-ticket under the per-feature setting (Challenger F8),
 * with only an stderr line saying so — the load-bearing assertion below is
 * that main's first-parent count grows by EXACTLY ONE (the feature merge);
 * a per-ticket regression makes it two and fails.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { git } from '@dokima/git';
import type { SpawnSession } from '@dokima/loop';
import { createTicket } from '@dokima/tickets';
import { defaultHandoffBuilder, type LandLoopOptions } from '@dokima/harbormaster';
import { executeBerthsRun } from './run-build-berths.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_VALIDATORS_DIR = path.resolve(HERE, '../../../..', 'content', 'validators');

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function setupFixture(): Promise<{ repoRoot: string; log: EventLog }> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-p611-repo-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Dokima Test']);
  await git(repoRoot, ['config', 'user.email', 'test@dokima.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-p611-db-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  cleanups.push(async () => {
    log.close();
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(dbDir, { recursive: true, force: true });
  });
  return { repoRoot, log };
}

/** Commits one file NAMED FOR THE TICKET so two members merge cleanly. */
const perTicketSpawn: SpawnSession = async (input) => {
  const ticketId = path.basename(input.cwd);
  const rel = `packages/example/${ticketId.toLowerCase()}.ts`;
  const filePath = path.join(input.cwd, rel);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `export const from = '${ticketId}';\n`);
  await git(input.cwd, ['add', '--', rel]);
  await git(input.cwd, ['commit', '-m', `feat: ${ticketId}`]);
  return {
    stdout: JSON.stringify({
      ticket: ticketId,
      files: [rel],
      verify: { command: 'true', exit: 0 },
      commits: [],
      evidence: [],
    }),
    stderr: '',
    exitCode: 0,
  };
};

describe('executeBerthsRun with landing=per-feature (P6-11)', () => {
  it('berths > 1 PARKS every landed ticket and the idle sweep lands the whole feature as EXACTLY ONE merge', async () => {
    const fixture = await setupFixture();
    for (const id of ['T-1', 'T-2']) {
      createTicket(fixture.log, 'worker-1', {
        id,
        type: 'task',
        title: `Ticket ${id}`,
        lane: id === 'T-1' ? 'core' : 'web', // distinct lanes so two berths may run
        writeScope: [`packages/example/${id.toLowerCase()}*`],
        verify: 'true',
      });
    }
    const landOptions: LandLoopOptions = {
      log: fixture.log,
      actorId: 'worker-1',
      projectId: 'proj-p6-11',
      repoRoot: fixture.repoRoot,
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: 'test-p6-11-signing-key',
      spawn: perTicketSpawn,
      pushToRemotes: async () => [],
      buildHandoff: defaultHandoffBuilder(),
      landing: 'per-feature',
      features: [{ id: 'F-1', title: 'the whole demo', tickets: ['T-1', 'T-2'] }],
      verifyFeature: async () => ({ green: true, detail: 'fake feature verify' }),
      now: () => new Date().toISOString(),
    };
    const before = Number(
      (await git(fixture.repoRoot, ['rev-list', '--count', '--first-parent', 'main']))
        .stdout,
    );
    const summary = await executeBerthsRun({
      log: fixture.log,
      runId: 'run-p6-11',
      projectId: 'proj-p6-11',
      berths: 2,
      landOptions,
      stderr: () => {},
    });
    const landedOutcomes = summary.processed.filter((o) => o.landed);
    expect(landedOutcomes.length).toBe(2);
    for (const o of landedOutcomes) {
      expect(o.parkedForFeatureLanding).toBe(true); // a park is not a landing
    }
    expect(summary.featureLandings?.map((f) => [f.featureId, f.landed])).toEqual([
      ['F-1', true],
    ]);
    const after = Number(
      (await git(fixture.repoRoot, ['rev-list', '--count', '--first-parent', 'main']))
        .stdout,
    );
    expect(after - before).toBe(1); // ONE feature merge — per-ticket would be 2
  }, 120_000);
});
