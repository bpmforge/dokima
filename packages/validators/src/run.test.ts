import { afterEach, describe, expect, it } from 'vitest';
import { runValidator, runValidatorPack, type ValidatorSpec } from './run.js';
import { createTempDir, writeScript, type TempDir } from './test-helpers.js';

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
});

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
});
