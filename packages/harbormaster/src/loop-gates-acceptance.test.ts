/**
 * W21-41. The red fixture is PLAN-vault-002 exactly: an acceptance criterion
 * that is a runnable command, a worktree with no spec files, and — before this
 * chapter — a clean close.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  humanCheckNotice,
  isExecutableCriterion,
  isNoOpScriptBody,
  noOpVerifyScripts,
  runAcceptanceCriteria,
  runGateChecks,
} from './loop-gates-acceptance.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function worktree(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'acceptance-'));
  dirs.push(dir);
  return dir;
}

describe('isExecutableCriterion (W21-41)', () => {
  it('RED FIXTURE: PLAN-vault-002’s criterion is a command, and was treated as prose', () => {
    expect(isExecutableCriterion('node --test src/crypto/*.spec.ts')).toBe(true);
  });

  it('the prose criteria this repo is full of are not commands', () => {
    for (const prose of [
      'Harness-committed paths do not fail the close gate’s commit-set scope check',
      'A red fixture pins the live case.',
      'release is refused when a different run holds the claim, naming both runs',
      'The decision is recorded in docs/ARCHITECTURE.md with its reasoning, either way',
    ]) {
      expect(isExecutableCriterion(prose)).toBe(false);
    }
  });

  it('recognises the runners a generated project actually uses', () => {
    for (const command of [
      'npm test',
      'pnpm lint && pnpm typecheck',
      'pytest tests/',
      'cargo test',
      'go test ./...',
    ]) {
      expect(isExecutableCriterion(command)).toBe(true);
    }
  });

  it('a sentence that merely starts with a runner word is still a sentence', () => {
    expect(isExecutableCriterion('node is pinned to 22 in .nvmrc.')).toBe(false);
  });

  it('empty text is not a command', () => {
    expect(isExecutableCriterion('   ')).toBe(false);
  });
});

describe('runAcceptanceCriteria (W21-41)', () => {
  it('RED FIXTURE: the live shape — a spec glob matching nothing fails, where it used to be ignored', async () => {
    const dir = worktree();
    await fs.mkdir(path.join(dir, 'src', 'crypto'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src/crypto/argon2id.ts'), 'export const x = 1;\n');
    const outcome = await runAcceptanceCriteria(
      dir,
      [{ id: 'AC-1', text: 'node --test src/crypto/*.spec.ts' }],
      30_000,
    );
    // AND THE POINT THAT MATTERS: node --test with a glob matching nothing
    // exits ZERO and prints `# tests 0`. So running the criterion would ALSO
    // have passed PLAN-vault-002 — the placeholder would have landed endorsed
    // by a green check. Zero tests executed has to be a failure.
    expect(outcome.runs).toHaveLength(1);
    expect(outcome.runs[0]!.exitCode).toBe(0);
    expect(outcome.runs[0]!.ranNothing).toBe(true);
    expect(outcome.reasons[0]).toContain('AC-1');
    expect(outcome.reasons[0]).toContain('ran NOTHING');
  }, 40_000);

  it('a real passing test run is fine — this refuses vacuous green, not green', async () => {
    const dir = worktree();
    await fs.writeFile(
      path.join(dir, 'real.test.js'),
      "const {test}=require('node:test');test('t',()=>{});\n",
    );
    const outcome = await runAcceptanceCriteria(dir, [{ id: 'AC-1', text: 'node --test real.test.js' }], 30_000);
    expect(outcome.runs[0]).toMatchObject({ exitCode: 0, ranNothing: false });
    expect(outcome.reasons).toHaveLength(0);
  }, 40_000);

  it('a criterion that passes is recorded with exit 0 and raises no reason', async () => {
    const dir = worktree();
    const outcome = await runAcceptanceCriteria(
      dir,
      [{ id: 'AC-1', text: 'node -e "process.exit(0)"' }],
      30_000,
    );
    expect(outcome.runs[0]).toMatchObject({ id: 'AC-1', exitCode: 0 });
    expect(outcome.reasons).toHaveLength(0);
  }, 40_000);

  it('prose criteria are reported as needing a person, never counted as satisfied', async () => {
    const dir = worktree();
    const outcome = await runAcceptanceCriteria(
      dir,
      [{ id: 'AC-1', text: 'The wrapper uses a real KDF, not an encoding' }],
      30_000,
    );
    expect(outcome.runs).toHaveLength(0);
    expect(outcome.needsHumanCheck).toEqual(['AC-1']);
    expect(outcome.reasons).toHaveLength(0);
  });

  it('mixed criteria: the command runs, the sentence goes to a person', async () => {
    const dir = worktree();
    const outcome = await runAcceptanceCriteria(
      dir,
      [
        { id: 'AC-1', text: 'node -e "process.exit(0)"' },
        { id: 'AC-2', text: 'The API reads well' },
      ],
      30_000,
    );
    expect(outcome.runs.map((r) => r.id)).toEqual(['AC-1']);
    expect(outcome.needsHumanCheck).toEqual(['AC-2']);
  }, 40_000);

  it('a ticket with no criteria is silent — this adds a check, it does not invent one', async () => {
    const outcome = await runAcceptanceCriteria(worktree(), [], 30_000);
    expect(outcome).toMatchObject({ runs: [], reasons: [], needsHumanCheck: [] });
  });
});

describe('humanCheckNotice (W21-41)', () => {
  it('says what was NOT checked — a receipt quiet about that claims more than it earned', () => {
    const notice = humanCheckNotice(['AC-2', 'AC-3']);
    expect(notice).toContain('AC-2, AC-3');
    expect(notice).toContain('no machine checked them');
  });

  it('nothing unchecked is null, not an empty reassurance', () => {
    expect(humanCheckNotice([])).toBeNull();
  });
});

/**
 * W21-87 RED FIXTURE (docs/TESTING.md planted-defect harness). Tally's first
 * ticket to reach a receipt is reproduced exactly: package.json ships
 * `"test": "echo 'Tests passed' || true"`, and the close gate re-runs
 * `npm run test` and sees exit 0. Before this chapter the gate minted on it.
 */
describe('isNoOpScriptBody (W21-87)', () => {
  it('refuses the exact body Tally shipped', () => {
    expect(isNoOpScriptBody("echo 'Tests passed' || true")).toBe(true);
  });

  it('refuses the other obvious shapes of a script that cannot fail', () => {
    for (const body of ['true', 'exit 0', ':', 'echo ok', 'echo a && true', 'echo a; exit 0', '  ']) {
      expect(isNoOpScriptBody(body), body).toBe(true);
    }
  });

  it('leaves a real runner alone — refusing good work is the expensive error', () => {
    for (const body of [
      'vitest run',
      'node --test',
      'jest --ci',
      'tsc --noEmit',
      'eslint .',
      'echo running && vitest run',
      'pytest -q',
    ]) {
      expect(isNoOpScriptBody(body), body).toBe(false);
    }
  });
});

describe('noOpVerifyScripts (W21-87)', () => {
  async function manifest(dir: string, scripts: Record<string, string>): Promise<void> {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ scripts }), 'utf8');
  }

  it('names the script the verify command actually invokes', async () => {
    const dir = worktree();
    await manifest(dir, {
      lint: 'eslint .',
      typecheck: 'tsc --noEmit',
      test: "echo 'Tests passed' || true",
    });

    const found = await noOpVerifyScripts(
      dir,
      'npm run lint && npm run typecheck && npm run test',
    );

    expect(found).toEqual([{ name: 'test', body: "echo 'Tests passed' || true" }]);
  });

  it('a script that exists but is not in the verify command is not the gate’s business', async () => {
    const dir = worktree();
    await manifest(dir, { test: 'vitest run', bench: 'echo soon' });
    expect(await noOpVerifyScripts(dir, 'npm run test')).toEqual([]);
  });

  it('a worktree with no manifest yields nothing — absence of evidence is not evidence of a lie', async () => {
    expect(await noOpVerifyScripts(worktree(), 'npm run test')).toEqual([]);
  });
});

describe('runGateChecks: the verify re-run is checked for vacuity too (W21-87)', () => {
  const base = { claimed: { command: 'npm test', exit: 0 }, criteria: [], timeoutMs: 30_000 };

  it('RED FIXTURE: a lying test script is refused BY NAME, though verify exits 0', async () => {
    const dir = worktree();
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { test: "echo 'Tests passed' || true" } }),
      'utf8',
    );

    const result = await runGateChecks({
      ...base,
      worktreePath: dir,
      verifyCommand: 'npm run test',
    });

    expect(result.verify.exitCode).toBe(0);
    const reason = result.reasons.join('\n');
    expect(reason).toContain('`test` cannot fail');
    expect(reason).toContain("echo 'Tests passed' || true");
  }, 60_000);

  it('a verify run that executed zero tests is refused, the way a criterion already was', async () => {
    const dir = worktree();

    const result = await runGateChecks({
      ...base,
      worktreePath: dir,
      verifyCommand: 'node -e "console.log(\'# tests 0\')"',
    });

    expect(result.verify.exitCode).toBe(0);
    expect(result.reasons.join('\n')).toContain('verify ran NOTHING');
  }, 60_000);

  it('a real verify command that really runs is untouched', async () => {
    const dir = worktree();
    await fs.writeFile(
      path.join(dir, 'real.test.js'),
      "const { test } = require('node:test');\ntest('adds', () => {});\n",
      'utf8',
    );
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { test: 'node --test real.test.js' } }),
      'utf8',
    );

    const result = await runGateChecks({
      ...base,
      worktreePath: dir,
      verifyCommand: 'npm run test',
    });

    expect(result.verify.exitCode).toBe(0);
    expect(result.reasons).toEqual([]);
  }, 60_000);
});
