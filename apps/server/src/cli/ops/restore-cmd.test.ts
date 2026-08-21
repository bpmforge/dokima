/** W19-03: `dokima restore` — the read-back half `dokima backup` never had. */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runRestoreCommand } from './restore-cmd.js';

describe('dokima restore (W19-03)', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  function io(cwd: string) {
    const out: string[] = [];
    const err: string[] = [];
    return {
      io: {
        cwd,
        stdout: (l: string) => out.push(l),
        stderr: (l: string) => err.push(l),
        now: () => new Date().toISOString(),
        env: {},
      },
      out,
      err,
    };
  }

  it('RED FIXTURE: replaces state.db from the named backup — before this command a founder with backups had no supported way to use one', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-restore-'));
    dirs.push(projectDir);
    const dbDir = path.join(projectDir, '.dokima');
    await fs.mkdir(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, 'state.db');
    await fs.writeFile(dbPath, 'CORRUPTED-CURRENT');
    const backupPath = path.join(dbDir, 'backups', 'state-2026.db');
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(backupPath, 'GOOD-BACKUP-BYTES');

    const { io: cli, out } = io(projectDir);
    const code = await runRestoreCommand([backupPath], cli as never);
    expect(code).toBe(0);
    expect(await fs.readFile(dbPath, 'utf8')).toBe('GOOD-BACKUP-BYTES');
    expect(out.join('\n')).toContain('replaced from');
  });

  it('refuses with usage when no file is named, and with a named error for a missing file', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-restore-'));
    dirs.push(projectDir);
    const a = io(projectDir);
    expect(await runRestoreCommand([], a.io as never)).toBe(2);
    expect(a.err.join('\n')).toContain('usage');
    const b = io(projectDir);
    expect(await runRestoreCommand(['/nope/missing.db'], b.io as never)).toBe(1);
    expect(b.err.join('\n')).toContain('no backup file');
  });
});
