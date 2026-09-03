// product-loop-berths.test.mjs — P6-07 integration: GAP -> proposal ->
// add-ticket VERB -> the PRODUCT's own engine claims and lands it.
//
// Everything on the board plane is REAL: the proposal reaches the event-log
// DB through the packaged CLI's add-ticket verb (never a direct DB write),
// and `run start --berths 1` (executeBuildRun -> runBerths -> the governor ->
// landClaimedTicket) claims it and lands the stub agent's manifest. Only the
// measurement plane (SRS text, proving tests, verify) is faked — that plane
// is the P5-01 suite's subject, not this file's.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productLoop, makeDrivePort } from './conductor/product-loop.mjs';
import { readProductBoard, appendProductTickets } from './conductor/berths-board.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = resolve(REPO, 'apps/server/src/bootstrap/cli-entry.mjs');

const US_RE = /\b(US-\d+)\b/g;
const asmStub = {
  deriveRequirementIds: (t) => [...new Set([...t.matchAll(US_RE)].map((m) => m[1]))],
  assemblyGate: ({ ledger, requirementIds, testExists }) => {
    const gaps = [];
    for (const id of requirementIds) {
      const e = ledger[id];
      if (!e || e.implementingTickets.length === 0)
        gaps.push(`requirement ${id} is uncovered: no ticket implements it`);
      else if (!e.provingTests.some((p) => testExists(p)))
        gaps.push(`requirement ${id} is coded-not-done: no existing proving test`);
    }
    return { pass: gaps.length === 0, gaps };
  },
  missingAssemblyTickets: () => [],
  generateAssemblyTickets: () => [],
  longTailGaps: () => [],
  generateLongTailWave: () => [],
};

let proj;
let stubDir;
beforeAll(() => {
  proj = mkdtempSync(join(tmpdir(), 'dokima-p607-'));
  // The stub lives OUTSIDE the project repo: an untracked file inside it
  // makes the engine's clean-tree discipline park the ticket (probed live).
  stubDir = mkdtempSync(join(tmpdir(), 'dokima-p607-stub-'));
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: proj, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  g(['init', '-q', '.']);
  g(['config', 'user.email', 'demo@dokima.local']);
  g(['config', 'user.name', 'demo']);
  g(['commit', '-q', '--allow-empty', '-m', 'init']);
  writeFileSync(
    join(stubDir, 'stub-agent.sh'),
    [
      '#!/usr/bin/env bash',
      'set -eu',
      // the PRD- proposal's write_scope is apps/**,packages/** — the stub
      // must land INSIDE it or the engine's scope gate rightly refuses
      'mkdir -p apps && echo 42 > apps/answer.txt',
      'git add apps/answer.txt',
      'git -c user.email=a@b.c -c user.name=agent commit -qm "PRD-US-1: answer"',
      'SHA="$(git rev-parse HEAD)"',
      'cat <<JSON',
      '{"ticket":"PRD-US-1","files":["apps/answer.txt"],"verify":{"command":"true","exit":0},"commits":["$SHA"],"evidence":["stub"],"memory_written":[]}',
      'JSON',
      '',
    ].join('\n'),
  );
  chmodSync(join(stubDir, 'stub-agent.sh'), 0o755);
});
afterAll(() => {
  rmSync(proj, { recursive: true, force: true });
  rmSync(stubDir, { recursive: true, force: true });
});

describe('P6-07 — the goal loop drives the PRODUCT engine against the PRODUCT board', () => {
  it('an uncovered story becomes an add-ticket verb call, the berths engine claims and lands it, and the loop exits done', async () => {
    const dbPath = '.dokima.db';
    const boardCfg = {
      root: proj,
      dbPath,
      cliEntry: CLI,
      spawn: (cmd, args) => spawnSync(cmd, args, { cwd: proj, encoding: 'utf8' }),
      verify: 'true',
    };
    let boardSnapshot = await readProductBoard(boardCfg).catch(() => []);
    let engineRuns = 0;
    const drive = makeDrivePort({
      engine: 'berths',
      projectId: 'p',
      berths: 1,
      dbPath: resolve(proj, dbPath),
      agentCommand: join(stubDir, 'stub-agent.sh'),
      spawn: (cmd, args) => {
        engineRuns++;
        const r = spawnSync(cmd, [resolve(REPO, args[0]), ...args.slice(1)], {
          cwd: proj,
          encoding: 'utf8',
          env: {
            ...process.env,
            DOKIMA_SIGNING_KEY: 'test-signing-key',
            // A hosted Linux runner has no OS keychain; without the W12-02
            // encrypted-file vault the CLI refuses ("vault is unreadable") —
            // the one refusal this test cannot see through a spawn (P6-21).
            DOKIMA_NO_KEYCHAIN: '1',
            DOKIMA_VAULT_KEY: 'test-vault-key',
          },
        });
        if (r.status !== 0 || !/1 landed/.test(r.stdout ?? '')) {
          console.error('run start stdout:', r.stdout);
          console.error('run start stderr:', r.stderr);
        }
        expect(r.status).toBe(0);
        return r;
      },
    });
    const ports = {
      readSources: () => 'Only US-1 exists.',
      readBoard: () => boardSnapshot,
      appendTickets: (rows) => {
        const refused = appendProductTickets(rows, boardCfg);
        expect(refused).toEqual([]);
      },
      writeLedger: () => {},
      // proven once the engine has actually run — the measurement plane is
      // faked here; the BOARD plane below is asserted for real
      provingTestsFor: () => (engineRuns > 0 ? ['e2e/us1.spec.ts'] : []),
      testExists: () => engineRuns > 0,
      seams: () => [],
      seamResults: () => [],
      verifyMain: () => ({ green: true }),
      runConductor: (call) => {
        drive(call);
        return readProductBoard(boardCfg).then((b) => {
          boardSnapshot = b;
        });
      },
      log: () => {},
      assembler: asmStub,
    };

    const r = await productLoop(ports, { maxIterations: 3 });
    expect(r.done).toBe(true);
    expect(engineRuns).toBe(1);

    // The REAL assertions: the proposal exists on the PRODUCT board and the
    // ENGINE moved it — in_review is landClaimedTicket's landing state
    // (a human accepts; maker != verifier), unreachable except through the
    // engine's own path.
    const board = await readProductBoard(boardCfg);
    const row = board.find((t) => t.id === 'PRD-US-1');
    expect(row).toBeDefined();
    expect(row.product_status).toBe('in_review');
    expect(row.status).toBe('todo'); // landed-but-unaccepted stays open for the loop
  }, 120_000);
});

describe('Challenger wave-2 fixes (F3/F4/F5/F7)', () => {
  const CLI_LOOP = resolve(REPO, 'scripts/product-loop.mjs');

  it('F3: --repo without --verify-cmd REFUSES — a target is judged by its own gate', () => {
    const r = spawnSync(process.execPath, [CLI_LOOP, '--repo', '/tmp', '--status'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('ITS OWN gate');
  });

  it('F4: --repo with the conductor engine REFUSES — that engine drives THIS repo only', () => {
    const r = spawnSync(
      process.execPath,
      [CLI_LOOP, '--repo', '/tmp', '--verify-cmd', 'true', '--status'],
      { cwd: REPO, encoding: 'utf8' },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--engine berths');
  });

  it('F5+F7: proposals carry the given verify command, and long_tail rides as the DECLARED tag', async () => {
    const { LONG_TAIL_TAG } = await import('./conductor/berths-board.mjs');
    const calls = [];
    appendProductTickets(
      [
        {
          id: 'LT-01',
          title: 'x',
          lane: 'product',
          write_scope: ['a/**'],
          acceptance: ['b1'],
          long_tail: true,
        },
        {
          id: 'PRD-US-9',
          title: 'y',
          lane: 'product',
          write_scope: ['a/**'],
          acceptance: ['c'],
        },
      ],
      {
        root: '/x',
        dbPath: 'db',
        cliEntry: 'cli',
        verify: 'node --test target/',
        spawn: (cmd, args) => (calls.push(args), { status: 0 }),
      },
    );
    const lt = calls[0];
    expect(lt[lt.indexOf('--verify') + 1]).toBe('node --test target/');
    expect(lt[lt.indexOf('--acceptance') + 1]).toContain(LONG_TAIL_TAG);
    const prd = calls[1];
    expect(prd[prd.indexOf('--acceptance') + 1]).not.toContain(LONG_TAIL_TAG);
  });

  it('F7 read side, through the REAL verb and reader: the tag classifies, an LT-named impostor stays ordinary', async () => {
    const { LONG_TAIL_TAG } = await import('./conductor/berths-board.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'p6-f7-'));
    try {
      const db = join(dir, 'f7.db');
      const add = (id, lane, acceptance) =>
        spawnSync(
          process.execPath,
          [
            CLI,
            'add-ticket',
            id,
            '--actor',
            'a',
            '--lane',
            lane,
            '--title',
            id,
            '--write-scope',
            `${lane}/**`,
            '--acceptance',
            acceptance,
            '--db',
            db,
          ],
          { cwd: dir, encoding: 'utf8' },
        );
      expect(add('LT-FAKE-1', 'x', 'totally not long tail').status).toBe(0);
      expect(add('ANY-1', 'y', `real one ${LONG_TAIL_TAG}`).status).toBe(0);
      const board = await readProductBoard({ root: dir, dbPath: 'f7.db' });
      expect(board.find((t) => t.id === 'LT-FAKE-1').long_tail).toBeUndefined();
      expect(board.find((t) => t.id === 'ANY-1').long_tail).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
