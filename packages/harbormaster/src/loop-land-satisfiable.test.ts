/**
 * W21-43. The red fixture is PLAN-vault-002 exactly: three implementation
 * files in write_scope, an acceptance criterion graded on spec files, and two
 * full sessions burned discovering a mismatch readable from the ticket record.
 */
import { describe, expect, it } from 'vitest';
import {
  referencedPaths,
  unsatisfiableCriteria,
  unsatisfiableNotice,
  contradictoryGates,
  contradictoryGateNotice,
} from './loop-land-satisfiable.js';

const VAULT_SCOPE = [
  'src/crypto/index.ts',
  'src/crypto/argon2id.ts',
  'src/crypto/aes-gcm.ts',
];

describe('unsatisfiableCriteria (W21-43)', () => {
  it('RED FIXTURE: PLAN-vault-002 — graded on specs it may not write', () => {
    const found = unsatisfiableCriteria(
      [{ id: 'AC-1', text: 'node --test src/crypto/*.spec.ts' }],
      VAULT_SCOPE,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: 'AC-1' });
    expect(found[0]!.outsideScope).toEqual(['src/crypto/*.spec.ts']);
  });

  it('the same ticket with the specs in scope is satisfiable — the founder answer works', () => {
    expect(
      unsatisfiableCriteria(
        [{ id: 'AC-1', text: 'node --test src/crypto/*.spec.ts' }],
        [...VAULT_SCOPE, 'src/crypto/*.spec.ts'],
      ),
    ).toHaveLength(0);
  });

  it('prose criteria are none of this check’s business', () => {
    expect(
      unsatisfiableCriteria(
        [{ id: 'AC-1', text: 'The wrapper uses a real KDF, not an encoding' }],
        VAULT_SCOPE,
      ),
    ).toHaveLength(0);
  });

  it('a command with no readable targets produces NO finding — a guess would block real work', () => {
    expect(unsatisfiableCriteria([{ id: 'AC-1', text: 'npm test' }], VAULT_SCOPE)).toHaveLength(0);
    expect(
      unsatisfiableCriteria([{ id: 'AC-1', text: 'pnpm lint && pnpm typecheck' }], VAULT_SCOPE),
    ).toHaveLength(0);
  });

  it('a broad scope covers everything the command names', () => {
    expect(
      unsatisfiableCriteria([{ id: 'AC-1', text: 'node --test src/crypto/*.spec.ts' }], ['src/**']),
    ).toHaveLength(0);
  });
});

describe('referencedPaths (W21-43)', () => {
  it('takes path-ish arguments and leaves flags and the runner alone', () => {
    expect(referencedPaths('node --test src/crypto/*.spec.ts')).toEqual([
      'src/crypto/*.spec.ts',
    ]);
    expect(referencedPaths('pytest tests/unit tests/e2e -q')).toEqual([
      'tests/unit',
      'tests/e2e',
    ]);
  });

  it('quotes are stripped — a quoted glob is the same target', () => {
    expect(referencedPaths(`node --test 'src/**/*.spec.ts'`)).toEqual(['src/**/*.spec.ts']);
  });

  it('a bare runner names nothing', () => {
    expect(referencedPaths('npm test')).toEqual([]);
  });
});

describe('unsatisfiableNotice (W21-43)', () => {
  it('names the paths, the verb, and why no attempt was made', () => {
    const notice = unsatisfiableNotice('PLAN-vault-002', [
      {
        id: 'AC-1',
        command: 'node --test src/crypto/*.spec.ts',
        outsideScope: ['src/crypto/*.spec.ts'],
      },
    ]);
    expect(notice).toContain('src/crypto/*.spec.ts');
    expect(notice).toContain('dokima widen-scope PLAN-vault-002');
    expect(notice).toContain('No attempt was made');
  });
});

describe('a ticket whose gates contradict each other (W21-47)', () => {
  const TYPECHECK =
    'verify re-run failed: `npm run typecheck` exited 1 (TS5097: An import path can ' +
    'only end with a .ts extension when allowImportingTsExtensions is enabled)';
  const ACCEPTANCE =
    'acceptance criterion AC-1 failed: `node --test src/crypto/*.spec.ts` exited 1 ' +
    '(ERR_MODULE_NOT_FOUND)';

  it('RED FIXTURE: PLAN-vault-002 — the same gate reason at R1 and R2 is surfaced', () => {
    // Runs 26 and 28 both climbed R1 to R2 and both rungs failed identically.
    // Climbing a rung IS the test of "would a stronger model fix this", and it
    // came back no — what is left is a property of the ticket.
    const found = contradictoryGates([
      { sessionLabel: 'coder-next', reasons: [TYPECHECK] },
      { sessionLabel: 'qwen3.8-27b', reasons: [TYPECHECK] },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.models).toEqual(['coder-next', 'qwen3.8-27b']);

    const notice = contradictoryGateNotice(found)!;
    expect(notice).toContain('2 different rungs');
    expect(notice).toContain('TS5097');
    expect(notice).toContain('no model can satisfy both');
  });

  it('the SAME rung failing twice is NOT surfaced — nothing has been ruled out', () => {
    // Acceptance 3. Without a rung change the ladder has not yet tested
    // whether a stronger model fixes it, and surfacing here would steal its job.
    expect(
      contradictoryGates([
        { sessionLabel: 'coder-next', reasons: [TYPECHECK] },
        { sessionLabel: 'coder-next', reasons: [TYPECHECK] },
      ]),
    ).toEqual([]);
  });

  it('DIFFERENT reasons on different rungs are not a contradiction', () => {
    // The ladder is still learning something; let it work.
    expect(
      contradictoryGates([
        { sessionLabel: 'coder-next', reasons: [TYPECHECK] },
        { sessionLabel: 'qwen3.8-27b', reasons: [ACCEPTANCE] },
      ]),
    ).toEqual([]);
  });

  it('an attempt with no rung label cannot establish "a different model tried it"', () => {
    // No rung seam means one model ran everything, which is the case above.
    expect(
      contradictoryGates([
        { sessionLabel: undefined, reasons: [TYPECHECK] },
        { sessionLabel: undefined, reasons: [TYPECHECK] },
      ]),
    ).toEqual([]);
  });

  it('reports every reason that repeated across rungs, not just the first', () => {
    const found = contradictoryGates([
      { sessionLabel: 'a', reasons: [TYPECHECK, ACCEPTANCE] },
      { sessionLabel: 'b', reasons: [TYPECHECK, ACCEPTANCE] },
    ]);
    expect(found).toHaveLength(2);
    const notice = contradictoryGateNotice(found)!;
    expect(notice).toContain('TS5097');
    expect(notice).toContain('ERR_MODULE_NOT_FOUND');
  });

  it('says nothing when there is nothing to say', () => {
    expect(contradictoryGateNotice([])).toBeNull();
    expect(contradictoryGates([])).toEqual([]);
  });
});
