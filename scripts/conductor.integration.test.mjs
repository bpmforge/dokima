// conductor.integration.test.mjs — W9-10 acceptance bullet 4: "A test drives
// the conductor against a fixture repo whose board is NOT at the root,
// proving the path is honoured end to end rather than only in the loader."
// Also covers W9-12: importing the conductor into a fresh repo with ONLY
// its two vendored files (conductor.mjs, conductor-lib.mjs) plus that
// repo's own conductor.config.json — no separate models.json required.
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
// a fixture conductor.config.json and .nvmrc. W9-12: deliberately does NOT
// vendor a scripts/models.json — that used to be a THIRD required file,
// read unconditionally at module load before --lint's early exit; the fix
// folds model routing into conductor.config.json (with a built-in default
// ladder in DEFAULT_CONFIG.models for repos that omit it entirely).
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

describe('conductor.mjs integration: configurable boardPath (W9-10)', () => {
  const scratchDirs = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function buildFixture(boardPath, board, configOverrides = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-conductor-fixture-'));
    scratchDirs.push(dir);

    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fs.copyFile(path.join(THIS_DIR, 'conductor.mjs'), path.join(dir, 'scripts', 'conductor.mjs'));
    await fs.copyFile(path.join(THIS_DIR, 'conductor-lib.mjs'), path.join(dir, 'scripts', 'conductor-lib.mjs'));
    // W10-46: the two entry points are now barrels over chapter directories, so
    // vendoring must bring the chapters too. This is the whole point of the
    // fixture — it proves a repo can vendor the harness and run it, and that
    // claim is only true if the copy is complete. `recursive` rather than a
    // file list on purpose: a new chapter must not silently fail to vendor.
    for (const chapterDir of ['conductor', 'conductor-lib']) {
      await fs.cp(
        path.join(THIS_DIR, chapterDir),
        path.join(dir, 'scripts', chapterDir),
        { recursive: true },
      );
    }
    await fs.writeFile(path.join(dir, '.nvmrc'), '22\n');
    await fs.writeFile(
      path.join(dir, 'conductor.config.json'),
      JSON.stringify({ boardPath, ...configOverrides }, null, 2),
    );

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

  it('W9-12: imports and lints with ONLY the two vendored files + conductor.config.json — no scripts/models.json, no "models" key at all — proving a fresh repo can import the harness with the config alone', async () => {
    const board = { version: 1, tickets: [] };
    const dir = await buildFixture('plan.json', board);

    await expect(fs.access(path.join(dir, 'scripts', 'models.json'))).rejects.toThrow();

    const { out, code } = runLint(dir);

    expect(out).toContain('0 error(s)');
    expect(code).toBe(0);
  });

  it('W9-12: a malformed "models" object in conductor.config.json produces an actionable startup error naming the missing roles, not a raw ENOENT/stack trace', async () => {
    const board = { version: 1, tickets: [] };
    // Only 'maker' set — cheap/reviewer/security/escalate are missing, same
    // shape of defect as a hand-edited or partially-migrated config.
    const dir = await buildFixture('plan.json', board, { models: { maker: 'sonnet' } });

    const { out, code } = runLint(dir);

    expect(out).toContain('invalid model routing');
    expect(out).toContain('models.cheap is required');
    expect(out).toContain('models.reviewer is required');
    expect(out).toContain('models.security is required');
    expect(out).toContain('models.escalate is required');
    expect(out).not.toContain('ENOENT');
    expect(out).not.toContain('at ModuleJob.run');
    expect(code).toBe(1);
  });

  it('W9-12 follow-up: malformed JSON in conductor.config.json itself (not the "models" key — the file\'s own syntax) produces an actionable error, not a raw SyntaxError/stack trace', async () => {
    const board = { version: 1, tickets: [] };
    const dir = await buildFixture('plan.json', board);
    // Overwrite with hand-broken JSON (trailing comma) — the exact defect
    // shape a fresh repo's hand-authored config is likely to have.
    await fs.writeFile(path.join(dir, 'conductor.config.json'), '{ "boardPath": "plan.json", }');

    const { out, code } = runLint(dir);

    expect(out).toContain('conductor.config.json is not valid JSON');
    expect(out).not.toContain('SyntaxError');
    expect(out).not.toContain('at ModuleJob.run');
    expect(code).toBe(1);
  });

  describe('conductor/gates.mjs: added-vs-modified append-only exemption for alwaysOk paths (W11-09)', () => {
    // Real branches, real commits, real git — scoped entirely inside the
    // throwaway fixture repo buildFixture already scaffolds (git init'd in
    // that same mkdtemp'd directory), never against this project's own repo.
    // gates.mjs's `git(...)` helper (scripts/conductor/context.mjs) always
    // runs with cwd = ROOT, and ROOT is derived from context.mjs's OWN file
    // location — so importing the FIXTURE's vendored copy of gates.mjs (not
    // this project's) makes its git plumbing operate on the fixture repo.
    // runGates() is called directly, in a throwaway `node` subprocess that
    // dynamically imports the fixture's scripts/conductor/gates.mjs: Vitest's
    // own module loader (Vite/vite-node) refuses to import a file outside its
    // configured fs root, even via a fully-qualified file:// URL, so a
    // same-process dynamic import of an mkdtemp fixture fails with "Does the
    // file exist?" against a file that plainly does — this sidesteps that by
    // never asking Vite to load it at all. conductor.mjs has no CLI flag that
    // runs gates alone (it only runs them mid-session, after spawning a real
    // `claude` process), and adding one would mean editing conductor.mjs —
    // outside this ticket's write_scope.
    function runGatesInFixture(dir, ticket, branch, wt) {
      const gatesUrl = pathToFileURL(path.join(dir, 'scripts', 'conductor', 'gates.mjs')).href;
      const script = [
        `const { runGates } = await import(${JSON.stringify(gatesUrl)});`,
        `process.stdout.write(JSON.stringify(runGates(${JSON.stringify(ticket)}, ${JSON.stringify(branch)}, ${JSON.stringify(wt)})));`,
      ].join('\n');
      const out = execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return JSON.parse(out);
    }

    function fixtureGit(dir) {
      return (...gitArgs) => execFileSync('git', gitArgs, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    }

    // No package.json in the fixture (buildFixture never writes one), so
    // runGates's install/lint/test/validators block — gated on
    // existsSync(resolve(wt, CONFIG.toolchainMarker)) — never runs; only the
    // cheap git-only checks this ticket touches do.
    async function buildGatesFixture() {
      const board = {
        version: 1,
        tickets: [
          { id: 'ZZ-01', title: 'fixture ticket', lane: 'infra', write_scope: ['docs/**'], depends_on: [], acceptance: ['does the thing'], status: 'done' },
        ],
      };
      const dir = await buildFixture('plan.json', board, {
        // packages/events/migrations/** deliberately does NOT also appear in
        // alwaysOk: if it did, the plain ALWAYS_OK check in gates.mjs would
        // exempt it unconditionally (any status) before the add-only check
        // ever ran, making alwaysOkAddOnly a no-op for it.
        alwaysOk: ['plan.json', 'docs/STATUS.md'],
        alwaysOkAddOnly: ['packages/events/migrations/**'],
      });

      await fs.mkdir(path.join(dir, 'packages/events/migrations'), { recursive: true });
      await fs.writeFile(
        path.join(dir, 'packages/events/migrations/001_init.sql'),
        '-- shipped migration\nCREATE TABLE events (id INTEGER PRIMARY KEY);\n',
      );
      await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
      await fs.writeFile(path.join(dir, 'docs/STATUS.md'), '# status\n');

      const git = fixtureGit(dir);
      git('init', '-q', '-b', 'main');
      git('config', 'user.email', 'fixture@example.com');
      git('config', 'user.name', 'Fixture');
      git('add', '-A');
      git('commit', '-q', '-m', 'initial: shipped migration 001_init.sql');

      return { dir, git };
    }

    it('RED FIXTURE 1/3: a branch that ADDS a new migration with no migrations glob in write_scope still passes the scope gate', async () => {
      const { dir, git } = await buildGatesFixture();
      git('checkout', '-q', '-b', 'sw/zz-01', 'main');
      await fs.writeFile(path.join(dir, 'packages/events/migrations/999_x.sql'), '-- new table\nCREATE TABLE widgets (id INTEGER PRIMARY KEY);\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'add 999_x.sql');

      const { gaps } = runGatesInFixture(dir, { id: 'ZZ-01', write_scope: ['docs/**'] }, 'sw/zz-01', dir);

      expect(gaps).toEqual([]);
    });

    it('RED FIXTURE 2/3: the same shape of branch MODIFYING an existing committed migration fails the scope gate, naming that path', async () => {
      const { dir, git } = await buildGatesFixture();
      git('checkout', '-q', '-b', 'sw/zz-01', 'main');
      await fs.appendFile(path.join(dir, 'packages/events/migrations/001_init.sql'), '-- edited in place\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'edit 001_init.sql in place');

      const { gaps } = runGatesInFixture(dir, { id: 'ZZ-01', write_scope: ['docs/**'] }, 'sw/zz-01', dir);

      expect(gaps).toEqual(['out-of-scope edits: packages/events/migrations/001_init.sql']);
    });

    it('RED FIXTURE 3/3: a ticket whose write_scope explicitly covers the existing migration file passes even though it MODIFIES it', async () => {
      const { dir, git } = await buildGatesFixture();
      git('checkout', '-q', '-b', 'sw/zz-01', 'main');
      await fs.appendFile(path.join(dir, 'packages/events/migrations/001_init.sql'), '-- edited in place, in scope\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'edit 001_init.sql in place, in scope');

      const { gaps } = runGatesInFixture(
        dir,
        { id: 'ZZ-01', write_scope: ['docs/**', 'packages/events/migrations/001_init.sql'] },
        'sw/zz-01',
        dir,
      );

      expect(gaps).toEqual([]);
    });

    it('a plain alwaysOk entry outside alwaysOkAddOnly still exempts a MODIFY — the fix does not narrow alwaysOk in general', async () => {
      const { dir, git } = await buildGatesFixture();
      git('checkout', '-q', '-b', 'sw/zz-01', 'main');
      await fs.appendFile(path.join(dir, 'docs/STATUS.md'), 'another line\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'edit docs/STATUS.md in place');

      const { gaps } = runGatesInFixture(dir, { id: 'ZZ-01', write_scope: ['some/unrelated/**'] }, 'sw/zz-01', dir);

      expect(gaps).toEqual([]);
    });
  });
});
