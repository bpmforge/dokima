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
  runAcceptanceCriteria,
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
