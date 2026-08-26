/**
 * W21-29. The out-of-session sweep exists to catch an agent writing outside
 * its scope. It must not catch the PRODUCT doing so — that cost three separate
 * live runs before it was understood.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { refuseIfSessionExceededScope } from './session-verdicts.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

const run = (cwd: string, args: string[]) =>
  new Promise<void>((resolve, reject) =>
    execFile('git', args, { cwd }, (err) => (err ? reject(err) : resolve())),
  );

async function repo(): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verdicts-'));
  dirs.push(dir);
  await run(dir, ['init', '-q']);
  await run(dir, ['config', 'user.email', 't@dokima.test']);
  await run(dir, ['config', 'user.name', 'T']);
  await fs.writeFile(path.join(dir, 'seed.txt'), 'seed');
  await run(dir, ['add', '-A']);
  await run(dir, ['commit', '-q', '-m', 'seed']);
  return dir;
}

describe('refuseIfSessionExceededScope (W21-29)', () => {
  it('RED FIXTURE: validator telemetry does not refuse a session — the harness wrote it, not the agent', async () => {
    const dir = await repo();
    await fs.mkdir(path.join(dir, 'docs', 'work'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'docs/work/telemetry.jsonl'),
      '{"source":"validator","validator":"secrets-scan","gaps":0,"exit":0}\n',
    );
    expect(await refuseIfSessionExceededScope(dir, ['src/**'])).toBeNull();
  });

  it('the harness’s install leavings are not the agent’s either', async () => {
    const dir = await repo();
    await fs.writeFile(path.join(dir, 'package-lock.json'), '{}');
    await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules/\n');
    expect(await refuseIfSessionExceededScope(dir, ['src/**'])).toBeNull();
  });

  it('the guard keeps its teeth: an AGENT-authored path outside scope is still refused', async () => {
    const dir = await repo();
    await fs.mkdir(path.join(dir, 'other'), { recursive: true });
    await fs.writeFile(path.join(dir, 'other/sneaky.ts'), 'export const x = 1;\n');
    const refusal = await refuseIfSessionExceededScope(dir, ['src/**']);
    expect(refusal).not.toBeNull();
    expect(refusal!.stderr).toContain('other/sneaky.ts');
    expect(refusal!.exitCode).toBe(1);
  });

  it('a path INSIDE write_scope is fine, harness list or not', async () => {
    const dir = await repo();
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src/index.ts'), 'export const x = 1;\n');
    expect(await refuseIfSessionExceededScope(dir, ['src/**'])).toBeNull();
  });
});
