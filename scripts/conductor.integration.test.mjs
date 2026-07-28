// conductor.integration.test.mjs — W9-10 acceptance bullet 4: "A test drives
// the conductor against a fixture repo whose board is NOT at the root,
// proving the path is honoured end to end rather than only in the loader."
//
// conductor.mjs can't be imported directly (it runs main() as a top-level
// side effect — see conductor-lib.mjs's header). So this drives the real
// script as a child process against a throwaway fixture directory that
// mimics a Kryptkeeper-shaped repo: board at docs/board/plan.json, not root.
// `--lint` is the one conductor.mjs mode with no git/claude side effects
// (same property W9-09's report used to verify the extraction).
//
// ROOT inside conductor.mjs is derived from the script's OWN file location
// (dirname(fileURLToPath(import.meta.url))), not from cwd — so the fixture
// needs its own copy of scripts/conductor.mjs + conductor-lib.mjs alongside
// a fixture conductor.config.json, scripts/models.json (read unconditionally
// at module load, before --lint's early exit), and .nvmrc.
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

describe('conductor.mjs integration: configurable boardPath (W9-10)', () => {
  const scratchDirs = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function buildFixture(boardPath, board) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-conductor-fixture-'));
    scratchDirs.push(dir);

    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fs.copyFile(path.join(THIS_DIR, 'conductor.mjs'), path.join(dir, 'scripts', 'conductor.mjs'));
    await fs.copyFile(path.join(THIS_DIR, 'conductor-lib.mjs'), path.join(dir, 'scripts', 'conductor-lib.mjs'));
    await fs.writeFile(
      path.join(dir, 'scripts', 'models.json'),
      JSON.stringify({ maker: 'sonnet', cheap: 'haiku', reviewer: 'sonnet', security: 'sonnet', escalate: 'opus' }),
    );
    await fs.writeFile(path.join(dir, '.nvmrc'), '22\n');
    await fs.writeFile(path.join(dir, 'conductor.config.json'), JSON.stringify({ boardPath }, null, 2));

    const boardFile = path.join(dir, boardPath);
    await fs.mkdir(path.dirname(boardFile), { recursive: true });
    await fs.writeFile(boardFile, JSON.stringify(board, null, 2));

    return dir;
  }

  function runLint(dir) {
    try {
      const out = execFileSync('node', ['scripts/conductor.mjs', '--lint'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { out, code: 0 };
    } catch (e) {
      return { out: `${e.stdout || ''}${e.stderr || ''}`, code: e.status };
    }
  }

  it('reads and lints a board that is NOT at the fixture repo root — proving boardPath is honoured end to end, not just by the loader', async () => {
    // Board lives at docs/board/plan.json (Kryptkeeper-shaped), with a
    // planted defect (a ticket missing the required 'lane' key) so a passing
    // assertion has to name it — not just "exit code happened to be 2". If
    // conductor.mjs instead fell back to a root plan.json (which does not
    // exist in this fixture), loadPlan() would throw ENOENT and main()'s
    // top-level .catch would log 'conductor.fatal' and exit 1 — a clearly
    // different, distinguishable failure mode from a lint report naming
    // this ticket's actual defect.
    const board = {
      version: 1,
      tickets: [
        {
          id: 'KK-01',
          title: 'Ticket with a missing lane',
          write_scope: ['scripts/**'],
          depends_on: [],
          acceptance: ['does the thing'],
          status: 'todo',
        },
      ],
    };
    const dir = await buildFixture('docs/board/plan.json', board);

    const { out, code } = runLint(dir);

    expect(out).toContain("KK-01: missing 'lane'");
    expect(code).toBe(2);
  });

  it('a clean board at a non-root boardPath lints OK (0 errors) — the happy path, not just the defect path', async () => {
    const board = {
      version: 1,
      tickets: [
        {
          id: 'KK-01',
          title: 'A clean ticket',
          lane: 'infra',
          write_scope: ['scripts/**'],
          depends_on: [],
          acceptance: ['does the thing'],
          status: 'todo',
        },
      ],
    };
    const dir = await buildFixture('docs/board/plan.json', board);

    const { out, code } = runLint(dir);

    expect(out).toContain('0 error(s)');
    expect(code).toBe(0);
  });
});
