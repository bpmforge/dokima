import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readLedgerMarkdown } from './ledger.js';

describe('readLedgerMarkdown — real per-project ledger, never caller-suppliable', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('returns the real docs/DECISIONS.md content when the file exists', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-ledger-'));
    dirs.push(projectDir);
    await fs.mkdir(path.join(projectDir, 'docs'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'docs', 'DECISIONS.md'),
      '| D-001 | 2026-07-19 | Deployment shape | self-hosted | fastest |',
      'utf8',
    );

    const markdown = await readLedgerMarkdown(projectDir);

    expect(markdown).toContain('D-001');
  });

  it('returns an empty string for a fresh project with no ledger file yet', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-ledger-'));
    dirs.push(projectDir);

    const markdown = await readLedgerMarkdown(projectDir);

    expect(markdown).toBe('');
  });
});
