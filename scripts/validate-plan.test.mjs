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
function runValidator(
  tickets,
  { experts = ['coding-agent', 'security-auditor', 'code-reviewer'] } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'dokima-plan-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  cpSync(join(here, 'validate-plan.mjs'), join(root, 'scripts', 'validate-plan.mjs'));
  mkdirSync(join(root, 'content', 'experts'), { recursive: true });
  for (const e of experts)
    writeFileSync(join(root, 'content', 'experts', `${e}.md`), '# expert\n');
  // P10 reads ARCHITECTURE.md and each package's manifest; copy the real ones
  // so this test fails on P11 alone and never on unrelated repo drift.
  cpSync(
    join(repoRoot, 'docs', 'ARCHITECTURE.md'),
    join(root, 'docs', 'ARCHITECTURE.md'),
    {
      recursive: true,
    },
  );
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
  writeFileSync(
    join(root, 'plan.json'),
    JSON.stringify({ version: 1, tickets }, null, 2),
  );
  try {
    const out = execFileSync(
      process.execPath,
      [join(root, 'scripts', 'validate-plan.mjs')],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
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
      ticket({
        status: 'done',
        acceptance: ['the Decide card shows the rejection reason'],
      }),
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

describe('P13 deferred-work report (2026-08-29)', () => {
  const deferral = 'the cross-run half is worth a follow-up';

  it('reports a ticket that defers work and names no ticket to carry it', () => {
    // Found by being caught: across one session five deferrals were written
    // down honestly, in the right place, and filed nowhere.
    const { code, out } = runValidator([ticket({ notes: [deferral] })]);
    expect(code).toBe(0); // report, never a failure
    expect(out).toContain('REPORT: P13');
    expect(out).toContain('W1-01');
  });

  it('is silent once the note names an OPEN ticket that carries it', () => {
    const { out } = runValidator([
      ticket({ id: 'W1-01', notes: [deferral, 'CARRIED FORWARD as W1-02'] }),
      ticket({ id: 'W1-02', title: 'the carrier', notes: [] }),
    ]);
    expect(out).not.toContain('W1-01 defers work');
  });

  it('a DONE ticket is not a carrier — history is not somewhere for work to live', () => {
    // "Mentions any ticket" matched almost everything, because this repo's
    // notes cite W-ids constantly, and the check reported zero — the L-47
    // failure it exists to prevent.
    const { out } = runValidator([
      ticket({ id: 'W1-01', notes: [deferral, 'see W1-02'] }),
      ticket({ id: 'W1-02', title: 'already done', status: 'done', notes: [] }),
    ]);
    expect(out).toContain('W1-01 defers work');
  });

  it('looks across ALL of a ticket’s notes, not just the deferring one', () => {
    // A deferral in one note and its carrier in another is how a ticket SHOULD
    // read. An earlier draft checked per-note and reported all five deferrals
    // it had just been given carriers for.
    const { out } = runValidator([
      ticket({ id: 'W1-01', notes: ['unrelated', deferral, 'filed as W1-02'] }),
      ticket({ id: 'W1-02', title: 'the carrier', notes: [] }),
    ]);
    expect(out).not.toContain('W1-01 defers work');
  });

  it('says nothing about a ticket that defers nothing', () => {
    const { out } = runValidator([ticket({ notes: ['ordinary evidence'] })]);
    expect(out).not.toContain('REPORT: P13');
  });
});

/**
 * W23-39: precision. Before this change P13 reported 24 tickets on the real
 * board and 7 of them owed nothing — three shapes, each pinned below by the
 * real note text that produced it. The live-deferral fixtures at the bottom are
 * the other half: a precision fix that loses a real report is not a fix.
 */
describe('P13 precision (W23-39)', () => {
  it('(a) a CARRIED FORWARD note whose carrier is now DONE is discharged, not re-reported', () => {
    // W21-77, W21-90, W22-02 followed the check's own instruction — name the
    // ticket — and were reported anyway the moment their carrier landed.
    const { out } = runValidator([
      ticket({
        id: 'W1-01',
        status: 'done',
        notes: [
          'the fixture-side retry is worth a follow-up',
          'CARRIED FORWARD as W1-02 (filed 2026-08-29): the fixture-side retry is now a ticket rather than a sentence.',
        ],
      }),
      ticket({ id: 'W1-02', title: 'the carrier, landed', status: 'done', notes: [] }),
    ]);
    expect(out).not.toContain('W1-01 defers work');
  });

  it('(a) a carry-forward naming a ticket that does not exist still reports', () => {
    const { out } = runValidator([
      ticket({
        id: 'W1-01',
        notes: ['the retry is worth a follow-up', 'CARRIED FORWARD as W9-99'],
      }),
    ]);
    expect(out).toContain('W1-01 defers work');
  });

  it('(b) a SCOPE WIDEN record is the action taken, not work promised', () => {
    // W21-95, verbatim in its shape.
    const { out } = runValidator([
      ticket({
        notes: [
          'SCOPE WIDENED ONCE MORE (Law 1): apps/web/e2e/board.spec.ts asserts the OLD empty-state sentence verbatim, so changing the copy necessarily reds it. Updating the assertion is part of this change rather than a follow-up. Unowned.',
        ],
      }),
    ]);
    expect(out).not.toContain('W1-01 defers work');
  });

  it('(b) a scope widen that ALSO defers the rest still reports', () => {
    const { out } = runValidator([
      ticket({
        notes: [
          'SCOPE WIDENED (Law 1): the spec is part of this change and not a follow-up. The Decide-card half is worth a follow-up.',
        ],
      }),
    ]);
    expect(out).toContain('W1-01 defers work');
  });

  it('(c) a note that QUOTES a deferral while recording its own filing is not a deferral', () => {
    // W23-37's own note: the filing for W22-26's deferral, quoting it.
    const { out } = runValidator([
      ticket({
        notes: [
          "DROPPED FINDING, filed 2026-09-20 during a P13 sweep. W22-26 wrote it down in its own closing note and filed nothing: 'Fixing the blindness does not fix the check; that asymmetry is still there and is worth its own ticket if anyone wants the gate to mean what the criterion says.' Law 1: a follow-up that names no ticket id is a dropped finding, not a deferral.",
        ],
      }),
    ]);
    expect(out).not.toContain('W1-01 defers work');
  });

  it('(c) a quotation is no loophole: a filing note that also defers in its own words reports', () => {
    const { out } = runValidator([
      ticket({
        notes: [
          "DROPPED FINDING, filed 2026-09-20: 'worth its own ticket'. The cross-run half is worth a follow-up.",
        ],
      }),
    ]);
    expect(out).toContain('W1-01 defers work');
  });

  // The two confirmed live deferrals of 2026-09-20, as they read BEFORE their
  // carriers (W23-36, W23-37) were filed. If either stops reporting, the
  // precision fix has eaten a real finding.
  it('still reports W22-15’s live deferral — which is itself a quotation of W9-14', () => {
    const { out } = runValidator([
      ticket({
        id: 'W22-15',
        status: 'done',
        notes: [
          "W9-14 WROTE THIS DOWN IN ADVANCE, in global-setup.ts's own header: 'Whether the Fleet view should itself hide or prune projects whose directory has vanished is a real question, but it is a product question and belongs in its own ticket.' Deleting mid-run is the test-side way of asking that product question, and A2's 'each suite removes' cannot be honoured literally without answering it. Removal moves to a global teardown that runs after every spec, where nothing can observe the gap.",
        ],
      }),
    ]);
    expect(out).toContain('W22-15 defers work');
  });

  it('still reports W22-26’s live deferral', () => {
    const { out } = runValidator([
      ticket({
        id: 'W22-26',
        status: 'done',
        notes: [
          "THE PRODUCT HAD ALREADY WRITTEN THE ACCEPTANCE FOR THIS AND COULD NOT MEET IT. Every deliverable draft carries 'It reflects what the interview actually established, not a template' while its verify command is `test -s <path>` — a criterion demanding grounding the maker was never given, checked by a command that can only see whether the file is empty. The close gate minted receipts for boilerplate against it. Fixing the blindness does not fix the check; that asymmetry is still there and is worth its own ticket if anyone wants the gate to mean what the criterion says.",
        ],
      }),
    ]);
    expect(out).toContain('W22-26 defers work');
  });
});
