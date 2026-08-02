import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VALIDATOR_PATH = path.resolve(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'content',
  'validators',
  'secrets-scan.sh',
);

interface ExecError extends Error {
  code: number;
  stdout: string;
  stderr: string;
}

let tmpDirs: string[] = [];

async function mkTmp(): Promise<string> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'dokima-secrets-scan-fixture-'),
  );
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tmpDirs = [];
});

// content/ scripts are run through `bash <path>` explicitly, not exec'd
// directly, mirroring packages/validators/src/run.ts's resolveCommand():
// git does not reliably preserve the executable bit on imported content.
async function runValidator(projectDir: string) {
  return execFileAsync('bash', [VALIDATOR_PATH, projectDir]);
}

describe('content/validators/secrets-scan.sh (BLUEPRINT §12.5 close-gate scanner)', () => {
  it('exists and is discoverable in content/validators', async () => {
    await expect(fs.stat(VALIDATOR_PATH)).resolves.toBeTruthy();
  });

  it('exits 0 with zero gaps on a clean project', async () => {
    const dir = await mkTmp();
    await fs.writeFile(
      path.join(dir, 'README.md'),
      '# Fine\n\nNo secrets in this project.\n',
    );

    const { stdout } = await runValidator(dir);
    const result = JSON.parse(stdout) as {
      validator: string;
      gaps: number;
      exit: number;
    };
    expect(result).toMatchObject({ validator: 'secrets-scan', gaps: 0, exit: 0 });
  });

  it('red fixture: a planted GitHub token in a diff blocks close (exit 1)', async () => {
    const dir = await mkTmp();
    await fs.writeFile(
      path.join(dir, 'leaked-config.txt'),
      'GITHUB_TOKEN=ghp_1234567890abcdef1234567890abcdef1234\n',
    );

    await expect(runValidator(dir)).rejects.toMatchObject({ code: 1 });
  });

  it('red fixture: a planted PEM private key blocks close and is reported with category pem-private-key', async () => {
    const dir = await mkTmp();
    await fs.writeFile(
      path.join(dir, 'id_rsa'),
      [
        '-----BEGIN RSA PRIVATE KEY-----',
        'MIIEowIBAAKCAQEAfakefakefakefakefakefakefakefakefakefakefake==',
        '-----END RSA PRIVATE KEY-----',
      ].join('\n'),
    );

    try {
      await runValidator(dir);
      throw new Error('expected the validator to exit non-zero');
    } catch (err) {
      const execErr = err as ExecError;
      expect(execErr.code).toBe(1);
      const result = JSON.parse(execErr.stdout) as {
        gaps: number;
        items: Array<{ category: string; detail: string }>;
      };
      expect(result.gaps).toBeGreaterThan(0);
      expect(result.items.some((item) => item.category === 'pem-private-key')).toBe(true);
    }
  });

  it('never echoes the raw secret value in its stdout — the scan itself must not leak', async () => {
    const dir = await mkTmp();
    const secret = 'ghp_1234567890abcdef1234567890abcdef1234';
    await fs.writeFile(path.join(dir, 'leaked-config.txt'), `token=${secret}\n`);

    try {
      await runValidator(dir);
      throw new Error('expected the validator to exit non-zero');
    } catch (err) {
      const execErr = err as ExecError;
      expect(execErr.code).toBe(1);
      expect(execErr.stdout).not.toContain(secret);
      expect(execErr.stderr).not.toContain(secret);
    }
  });

  it('does not flag its own pattern-definition source line', async () => {
    // Copy the validator itself into the scanned fixture -- its own source
    // contains the literal regex text (e.g. "AKIA[0-9A-Z]{16}") but no real
    // matching secret shape, and the file is explicitly self-excluded.
    const dir = await mkTmp();
    const contents = await fs.readFile(VALIDATOR_PATH, 'utf8');
    await fs.writeFile(path.join(dir, 'secrets-scan.sh'), contents);

    const { stdout } = await runValidator(dir);
    const result = JSON.parse(stdout) as { gaps: number; exit: number };
    expect(result).toMatchObject({ gaps: 0, exit: 0 });
  });
});
