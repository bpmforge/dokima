/**
 * P11 (D-025, W12-06): the board's optional `role` field.
 *
 * `validate-plan.mjs` reads `plan.json` relative to its OWN location and exits
 * the process, so it is exercised the way it actually runs: a temp root with a
 * scripts/ copy, a plan.json, and a content/experts/ pack. That is clumsier
 * than importing a function, and it is the point — it proves the real script,
 * including the file-system walk that reads the roster, not a re-derivation of
 * it that could pass while the script fails.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const roots = [];

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function ticket(overrides = {}) {
  return {
    id: 'W1-01',
    title: 'a ticket',
    phase: 1,
    module: 'shared',
    lane: 'core',
    write_scope: ['packages/shared/**'],
    depends_on: [],
    acceptance: ['does the thing'],
    points: 3,
    status: 'todo',
    notes: [],
    stories: [],
    ...overrides,
  };
}

/** Runs the REAL validator against a plan of our making; returns {code, out}. */
function runValidator(tickets, { experts = ['coding-agent', 'security-auditor', 'code-reviewer'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dokima-plan-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  cpSync(join(here, 'validate-plan.mjs'), join(root, 'scripts', 'validate-plan.mjs'));
  mkdirSync(join(root, 'content', 'experts'), { recursive: true });
  for (const e of experts) writeFileSync(join(root, 'content', 'experts', `${e}.md`), '# expert\n');
  // P10 reads ARCHITECTURE.md and each package's manifest; copy the real ones
  // so this test fails on P11 alone and never on unrelated repo drift.
  cpSync(join(repoRoot, 'docs', 'ARCHITECTURE.md'), join(root, 'docs', 'ARCHITECTURE.md'), {
    recursive: true,
  });
  // P10 cross-checks ARCHITECTURE.md's matrix against every row-package's
  // declared deps, apps/ included — copy only the manifests it reads.
  for (const dir of ['packages', 'apps']) {
    cpSync(join(repoRoot, dir), join(root, dir), {
      recursive: true,
      filter: (src) =>
        !src.includes('node_modules') &&
        (statSync(src).isDirectory() || src.endsWith('package.json')),
    });
  }
  writeFileSync(join(root, 'plan.json'), JSON.stringify({ version: 1, tickets }, null, 2));
  try {
    const out = execFileSync(process.execPath, [join(root, 'scripts', 'validate-plan.mjs')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('P11 role validation (W12-06)', () => {
  it('accepts a ticket with no role at all — 208 done tickets carry none', () => {
    expect(runValidator([ticket()]).code).toBe(0);
  });

  it('accepts a role that names a real expert in the pack', () => {
    expect(runValidator([ticket({ role: 'security-auditor' })]).code).toBe(0);
  });

  it(
    'RED FIXTURE: an unknown role FAILS BY NAME. A typo that silently routes ' +
      'to coding-agent is the exact silent-degradation this field exists to end',
    () => {
      const { code, out } = runValidator([ticket({ role: 'securty-auditor' })]);
      expect(code).toBe(1);
      expect(out).toContain('securty-auditor');
      expect(out).toContain('P11');
    },
  );

  it('refuses a verifier role as the expert that DOES the work (C-4)', () => {
    const { code, out } = runValidator([ticket({ role: 'code-reviewer' })]);
    expect(code).toBe(1);
    expect(out).toContain('C-4');
  });

  it('refuses a non-string or empty role rather than coercing it', () => {
    expect(runValidator([ticket({ role: '' })]).code).toBe(1);
    expect(runValidator([ticket({ role: 42 })]).code).toBe(1);
  });

  it('the field is OPTIONAL, not unknown — P2 would reject an undeclared key', () => {
    const { code, out } = runValidator([ticket({ nonsense: 'x' })]);
    expect(code).toBe(1);
    expect(out).toContain('unknown key nonsense');
  });
});

describe('P12 acceptance-vs-write_scope report (W22-03)', () => {
  it('names the ticket, the widget and the criterion when a non-web scope needs the web', () => {
    const { code, out } = runValidator([
      ticket({ acceptance: ['the Decide card shows the rejection reason'] }),
    ]);
    // REPORT, NOT FAILURE. Measured precision is ~13%: a validator wrong six
    // times out of seven teaches people to ignore it (D-014, W21-38), which is
    // why this ticket's own third criterion says silence beats a false
    // positive. The exit code is the assertion that matters most here.
    expect(code).toBe(0);
    // The REPORT:/REPORT-CONT: prefix is not cosmetic — it is the contract
    // run-validators.mjs forwards from a PASSING validator. Drop it and this
    // report prints into a void under `pnpm validate`, which is the only place
    // Law 3 runs it: a check nobody sees, the exact failure it exists to catch.
    expect(out).toContain('REPORT: P12');
    expect(out).toContain('REPORT-CONT:');
    expect(out).toContain('W1-01');
    expect(out).toContain('card');
    expect(out).toContain('the Decide card shows the rejection reason');
  });

  it('is silent when the write_scope can actually reach the surface', () => {
    const { out } = runValidator([
      ticket({
        module: 'web',
        lane: 'ui',
        write_scope: ['apps/web/src/decisions/**'],
        acceptance: ['the Decide card shows the rejection reason'],
      }),
    ]);
    expect(out).not.toContain('P12');
  });

  it('is silent on a criterion that names no rendered surface', () => {
    const { out } = runValidator([
      ticket({ acceptance: ['the receipt records the rejection reason'] }),
    ]);
    expect(out).not.toContain('P12');
  });

  it('is silent on evidence narrative, which mentions surfaces in passing', () => {
    // The 44 retrospective hits were overwhelmingly this shape — a long
    // past-tense finding that happens to name a panel. Capping the length is
    // what took precision from ~4% to ~13%.
    const narrative =
      'MEASURED 2026-08-03 with the Canvas open: a project was configured through the ' +
      'Providers and Models panel, LM Studio registered and reachable with 23 models ' +
      'discovered, and the run still died at the old ceiling despite the raised setting, ' +
      'which is what makes this a defect rather than a tuning preference.';
    expect(narrative.length).toBeGreaterThan(200);
    const { out } = runValidator([ticket({ acceptance: [narrative] })]);
    expect(out).not.toContain('P12');
  });

  it('says nothing at all about a done ticket — it reports the live surface only', () => {
    const { out } = runValidator([
      ticket({ status: 'done', acceptance: ['the Decide card shows the rejection reason'] }),
    ]);
    expect(out).not.toContain('P12');
  });

  it('does not treat "board" as a widget — it is this product\'s central domain noun', () => {
    const { out } = runValidator([
      ticket({ acceptance: ['the board reflows dependants to Ready'] }),
    ]);
    expect(out).not.toContain('P12');
  });
});
