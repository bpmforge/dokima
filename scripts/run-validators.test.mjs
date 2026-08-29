import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ratchetArgsByValidator, VALIDATORS } from './run-validators.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * W22-06. `pnpm validate` ran every validator with NO arguments, so
 * `validate-exports` always exited 0 there regardless of its count — its two
 * baselines arrive as `--max`/`--max-buried`, and a ratchet with no number has
 * nothing to exceed. The per-ticket conductor gate passed the real ones, so the
 * same validator enforced in one place and only reported in the other. Nobody
 * was watching the number that was not enforced, and it had drifted.
 */
describe('the Law 3 validator run carries the conductor gate’s ratchets', () => {
  it('reads validate-exports’ baselines rather than keeping a second copy', () => {
    const args = ratchetArgsByValidator().get('validate-exports');
    expect(args).toBeDefined();
    expect(args).toContain('--max');
    expect(args).toContain('--max-buried');
  });

  it('RED FIXTURE: the numbers are the SAME OBJECT the conductor gate uses', () => {
    // This is the whole acceptance: one place, so the two callers cannot
    // drift. A hardcoded copy here would pass every other test in this file
    // and reintroduce the drift the moment either number moved.
    const config = JSON.parse(readFileSync(path.join(ROOT, 'conductor.config.json'), 'utf8'));
    const gate = config.gates.find(
      (g) => Array.isArray(g?.[1]) && g[1][0] === 'scripts/validate-exports.mjs',
    );
    expect(gate).toBeDefined();
    expect(ratchetArgsByValidator().get('validate-exports')).toEqual(gate[1].slice(1));
  });

  it('a validator the gate does not list runs with no arguments, as before', () => {
    // validate-ui-copy, volatile-paths and history-secrets are in the Law 3
    // set but not in the conductor gate. They must be unaffected.
    const byName = ratchetArgsByValidator();
    expect(byName.get('validate-ui-copy')).toBeUndefined();
    expect(byName.get('validate-volatile-paths')).toBeUndefined();
  });

  it('every ratcheted validator in the gate is actually in the Law 3 set', () => {
    // Otherwise a baseline could be configured for something pnpm validate
    // never runs — a number nobody enforces, which is this ticket's defect
    // wearing different clothes.
    for (const [name, args] of ratchetArgsByValidator()) {
      if (args.length === 0) continue;
      expect(VALIDATORS).toContain(name);
    }
  });

  it('importing this module does not run the validators', () => {
    // The entry guard. Without it, this test file would shell out to six
    // validators on import — including a ~20s export scan.
    expect(VALIDATORS.length).toBeGreaterThan(0);
  });

  it('and the script still runs when invoked directly', () => {
    // The guard's other half, and the failure W22-01 nearly shipped: a guard
    // that never matches makes the command silently do nothing.
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/run-validators.mjs')], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    expect(out).toContain('validate-exports');
    expect(out).toContain('validators clean');
  }, 120_000);
});
