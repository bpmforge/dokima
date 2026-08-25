import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runValidator, runValidatorPack, type ValidatorSpec } from './run.js';
import { createTempDir, writeScript, type TempDir } from './test-helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `packages/validators/src` -> repo root -> `content/validators`. */
const REAL_MERMAID_VALIDATOR = path.resolve(
  HERE,
  '..',
  '..',
  '..',
  'content',
  'validators',
  'validate-mermaid.sh',
);

/**
 * W21-07: these fixtures SPAWN PROCESSES — a validator script per case, and
 * one that deliberately hangs so the watchdog can be proven to kill it. Held
 * to vitest's 5s default they fail under full-suite load and pass in
 * isolation, which is the signature of a starved subprocess, not a bug: the
 * failures read "Test timed out in 5000ms" and never name an assertion.
 *
 * The timeout is raised; no assertion is loosened and no fixture work is cut.
 * A gate one busy machine away from red is not a gate — but neither is one
 * that went green by asserting less. (Same call as W20-13.)
 */
const SUBPROCESS_TIMEOUT_MS = 30_000;

describe('runValidator', () => {
  let temp: TempDir;

  afterEach(async () => {
    await temp?.cleanup();
  });

  it('reports a clean pass', async () => {
    temp = await createTempDir('run-clean');
    const scriptPath = await writeScript(
      temp.dir,
      'clean.sh',
      '#!/bin/bash\nprintf \'{"validator":"clean","gaps":0,"exit":0,"items":[]}\\n\'\nexit 0\n',
    );
    const spec: ValidatorSpec = { name: 'clean', path: scriptPath };
    const result = await runValidator(spec, { cwd: temp.dir, timeoutMs: 5_000 });
    expect(result).toMatchObject({ exitCode: 0, gapCount: 0, timedOut: false });
  });

  it('reports gaps found (exit 1)', async () => {
    temp = await createTempDir('run-gaps');
    const scriptPath = await writeScript(
      temp.dir,
      'gappy.sh',
      '#!/bin/bash\n' +
        'printf \'{"validator":"gappy","gaps":1,"exit":1,"items":[{"category":"x","detail":"y"}]}\\n\'\n' +
        'exit 1\n',
    );
    const spec: ValidatorSpec = { name: 'gappy', path: scriptPath };
    const result = await runValidator(spec, { cwd: temp.dir, timeoutMs: 5_000 });
    expect(result.exitCode).toBe(1);
    expect(result.gapCount).toBe(1);
    expect(result.gaps).toEqual([{ category: 'x', detail: 'y' }]);
  });

  it('runs against the given sandbox cwd, not the caller process cwd', async () => {
    temp = await createTempDir('run-cwd');
    const scriptPath = await writeScript(
      temp.dir,
      'pwd-check.sh',
      '#!/bin/bash\n' +
        'printf \'{"validator":"pwd-check","gaps":0,"exit":0,"items":["%s"]}\\n\' "$(pwd)"\n' +
        'exit 0\n',
    );
    const spec: ValidatorSpec = { name: 'pwd-check', path: scriptPath };
    const result = await runValidator(spec, { cwd: temp.dir, timeoutMs: 5_000 });
    expect(result.stdout).toContain(temp.dir);
  });

  it('kills a hanging validator at the timeout and reports it as a failure — never a silent pass', async () => {
    temp = await createTempDir('run-hang');
    const scriptPath = await writeScript(
      temp.dir,
      'hang.sh',
      '#!/bin/bash\nsleep 30\nprintf \'{"validator":"hang","gaps":0,"exit":0,"items":[]}\\n\'\nexit 0\n',
    );
    const spec: ValidatorSpec = { name: 'hang', path: scriptPath };
    const result = await runValidator(spec, { cwd: temp.dir, timeoutMs: 300 });
    expect(result.exitCode).toBe(2);
    expect(result.timedOut).toBe(true);
    expect(result.gaps[0]?.category).toBe('timeout');
  });

  it('reports garbage stdout as a failure even when the process exits 0 — never a silent pass', async () => {
    temp = await createTempDir('run-garbage');
    const scriptPath = await writeScript(
      temp.dir,
      'garbage.sh',
      '#!/bin/bash\necho "everything looks great, no notes"\nexit 0\n',
    );
    const spec: ValidatorSpec = { name: 'garbage', path: scriptPath };
    const result = await runValidator(spec, { cwd: temp.dir, timeoutMs: 5_000 });
    expect(result.exitCode).toBe(2);
    expect(result.gaps[0]?.category).toBe('malformed-output');
  });

  it('reports a contract violation when exit code and gap count disagree', async () => {
    temp = await createTempDir('run-disagree');
    const scriptPath = await writeScript(
      temp.dir,
      'liar.sh',
      '#!/bin/bash\n' +
        'printf \'{"validator":"liar","gaps":3,"exit":0,"items":[]}\\n\'\n' +
        'exit 0\n',
    );
    const spec: ValidatorSpec = { name: 'liar', path: scriptPath };
    const result = await runValidator(spec, { cwd: temp.dir, timeoutMs: 5_000 });
    expect(result.exitCode).toBe(2);
    expect(result.gaps.some((g) => g.category === 'contract-violation')).toBe(true);
  });

  it('reports a spawn error (nonexistent executable) as a failure', async () => {
    temp = await createTempDir('run-missing');
    const spec: ValidatorSpec = {
      name: 'missing',
      path: `${temp.dir}/does-not-exist.sh`,
    };
    const result = await runValidator(spec, { cwd: temp.dir, timeoutMs: 5_000 });
    expect(result.exitCode).toBe(2);
    expect(result.gaps[0]?.category).toBe('spawn-error');
  });
}, SUBPROCESS_TIMEOUT_MS);

/**
 * W9-08 unblock proof: the REAL, unmodified `content/validators/
 * validate-mermaid.sh` — not a synthetic stand-in — run through the real
 * `runValidator`. Before this ticket, a clean scan exited 0 with zero-byte
 * stdout, which `parseValidatorOutput('')` correctly reports as malformed
 * (Defect 1), so `runValidator` normalized every clean mermaid run to
 * `exitCode: 2`. `PHASES[0]` (Idea) and `PHASES[1]` (Plan) declare only
 * `MERMAID_VALIDATOR` (`packages/pipeline/src/phases/topology.ts`), so this
 * exact assertion — `exitCode: 0` for a clean real run — is what makes those
 * two phases gateable; `runPhaseGate`'s own end-to-end demonstration belongs
 * to W9-07, not here. `MERMAID_NO_RENDER=1` keeps this test independent of
 * whether the optional `mmdc` CLI happens to be installed on the runner
 * (Law 9 — local-first, no external tool dependency for a clean-pass proof).
 */
describe('runValidator against the real content/validators/validate-mermaid.sh (W9-08)', () => {
  let temp: TempDir;
  let previousNoRender: string | undefined;
  let previousTelemetry: string | undefined;

  beforeEach(() => {
    // `runValidator` has no env-override seam — it inherits `process.env` via
    // execa's default behavior — so this test controls the two knobs
    // `validate-mermaid.sh` itself reads directly on `process.env`
    // (`MERMAID_NO_RENDER` skips the optional `mmdc` render pass so the
    // result doesn't depend on whether that CLI happens to be installed on
    // the runner; `EXPERTS_TELEMETRY=0` keeps this test from writing rows to
    // any `docs/work/telemetry.jsonl`).
    previousNoRender = process.env.MERMAID_NO_RENDER;
    previousTelemetry = process.env.EXPERTS_TELEMETRY;
    process.env.MERMAID_NO_RENDER = '1';
    process.env.EXPERTS_TELEMETRY = '0';
  });

  afterEach(async () => {
    await temp?.cleanup();
    if (previousNoRender === undefined) delete process.env.MERMAID_NO_RENDER;
    else process.env.MERMAID_NO_RENDER = previousNoRender;
    if (previousTelemetry === undefined) delete process.env.EXPERTS_TELEMETRY;
    else process.env.EXPERTS_TELEMETRY = previousTelemetry;
  });

  it('reports exitCode 0 for a clean run — the mermaid gate is unblocked', async () => {
    temp = await createTempDir('mermaid-clean');
    await fs.mkdir(path.join(temp.dir, 'docs'), { recursive: true });
    await fs.writeFile(
      path.join(temp.dir, 'docs', 'VISION.md'),
      '# Vision\n\nA plain document with no Mermaid diagrams at all.\n',
    );

    const spec: ValidatorSpec = {
      name: 'validate-mermaid',
      path: REAL_MERMAID_VALIDATOR,
    };
    const result = await runValidator(spec, { cwd: temp.dir, timeoutMs: 15_000 });

    expect(result.exitCode).toBe(0);
    expect(result.gapCount).toBe(0);
    expect(result.gaps).toEqual([]);
  });

  it('reports exitCode 1 (not 2) for a single real finding — Defect 2 fixed end to end', async () => {
    temp = await createTempDir('mermaid-one-finding');
    await fs.mkdir(path.join(temp.dir, 'docs'), { recursive: true });
    // Exactly ONE M013 backtick error — the single-finding case that used to
    // misparse as malformed (exitCode 2) instead of "1 real gap" (exitCode 1).
    await fs.writeFile(
      path.join(temp.dir, 'docs', 'VISION.md'),
      [
        '# Vision',
        '',
        '```mermaid',
        'flowchart TD',
        '  A[`bad label`] --> B[Ok]',
        '```',
        '',
      ].join('\n'),
    );

    const spec: ValidatorSpec = {
      name: 'validate-mermaid',
      path: REAL_MERMAID_VALIDATOR,
    };
    const result = await runValidator(spec, { cwd: temp.dir, timeoutMs: 15_000 });

    expect(result.exitCode).toBe(1);
    expect(result.gapCount).toBe(1);
    expect(result.gaps[0]?.category).toBe('M013');
  });
}, SUBPROCESS_TIMEOUT_MS);

describe('runValidatorPack', () => {
  it('runs every spec against the same sandbox', async () => {
    const temp = await createTempDir('pack');
    try {
      const a = await writeScript(
        temp.dir,
        'a.sh',
        '#!/bin/bash\nprintf \'{"validator":"a","gaps":0,"exit":0,"items":[]}\\n\'\nexit 0\n',
      );
      const b = await writeScript(
        temp.dir,
        'b.sh',
        '#!/bin/bash\nprintf \'{"validator":"b","gaps":1,"exit":1,"items":[{"category":"c","detail":"d"}]}\\n\'\nexit 1\n',
      );
      const results = await runValidatorPack(
        [
          { name: 'a', path: a },
          { name: 'b', path: b },
        ],
        { cwd: temp.dir, timeoutMs: 5_000 },
      );
      expect(results.map((r) => [r.name, r.exitCode])).toEqual([
        ['a', 0],
        ['b', 1],
      ]);
    } finally {
      await temp.cleanup();
    }
  });
}, SUBPROCESS_TIMEOUT_MS);
