/**
 * W23-15. The plan is asserted WITHOUT running the real gate: the questions
 * that matter — does a failure still fail everything, is the output stable,
 * are the ratchets the configured ones, is the bound respected — are all
 * answerable with an injected runner, and a test that shells out to six real
 * validators would answer them slowly and less exactly.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CONCURRENCY,
  formatResults,
  gatePlan,
  runGatePlan,
} from './gate-plan.mjs';
import { VALIDATORS, ratchetArgsByValidator } from './run-validators.mjs';

test('the plan is exactly the serial list, with the configured ratchet arguments', () => {
  const plan = gatePlan();
  assert.deepEqual(
    plan.map((entry) => entry.name),
    [...VALIDATORS],
  );
  const configured = ratchetArgsByValidator();
  const exports = plan.find((e) => e.name === 'validate-exports');
  assert.deepEqual(exports.args, configured.get('validate-exports'));
  // And it is not empty, because an empty argument list is exactly how the
  // ratchet was silently disabled once before (W22-06).
  assert.ok(exports.args.includes('--max'));
});

test('validate-temp-leaks is NOT in the parallel group — it reads the machine, not the source', () => {
  assert.equal(
    gatePlan().some((entry) => entry.name === 'validate-temp-leaks'),
    false,
  );
});

test('a single failing validator fails the aggregate, and every group keeps its output', async () => {
  const plan = gatePlan();
  const { results } = await runGatePlan({
    plan,
    run: async (entry) => ({
      ...entry,
      status: entry.name === 'validate-ui-copy' ? 1 : 0,
      stdout:
        entry.name === 'validate-ui-copy'
          ? 'the failing one says its own words'
          : `${entry.name} said something\nREPORT: a passing check with a note`,
      stderr: entry.name === 'validate-ui-copy' ? 'ui copy drifted' : '',
    }),
  });
  assert.equal(results.filter((r) => r.status !== 0).length, 1);
  const lines = formatResults(results).join('\n');
  // The failure's own words survive...
  assert.match(lines, /ui copy drifted/);
  // ...and so does every passing group's REPORT line. A parallel runner that
  // interleaves or drops output makes a green run unreadable and a red one
  // unactionable.
  assert.equal(
    (lines.match(/a passing check with a note/g) ?? []).length,
    plan.length - 1,
  );
});

test('output order is the PLAN order, whatever order the children finish in', async () => {
  const plan = gatePlan();
  const { results } = await runGatePlan({
    plan,
    concurrency: plan.length,
    // Finish in reverse: the last entry returns first.
    run: async (entry) => {
      const index = plan.findIndex((e) => e.name === entry.name);
      await new Promise((r) => setTimeout(r, (plan.length - index) * 2));
      return { ...entry, status: 0, stdout: '', stderr: '' };
    },
  });
  assert.deepEqual(
    results.map((r) => r.name),
    plan.map((e) => e.name),
  );
});

test('the concurrency bound is respected — a gate must not fork the machine flat', async () => {
  const plan = gatePlan();
  const { peakConcurrency } = await runGatePlan({
    plan,
    concurrency: 2,
    run: async (entry) => {
      await new Promise((r) => setTimeout(r, 5));
      return { ...entry, status: 0, stdout: '', stderr: '' };
    },
  });
  assert.ok(peakConcurrency <= 2, `peak was ${peakConcurrency}`);
  assert.ok(DEFAULT_CONCURRENCY >= 1);
});

test('every entry runs exactly once, including when one of them fails', async () => {
  const plan = gatePlan();
  const seen = [];
  await runGatePlan({
    plan,
    run: async (entry) => {
      seen.push(entry.name);
      return {
        ...entry,
        status: entry.name === 'validate-plan' ? 1 : 0,
        stdout: '',
        stderr: '',
      };
    },
  });
  assert.deepEqual(seen.slice().sort(), plan.map((e) => e.name).sort());
});
