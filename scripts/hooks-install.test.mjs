// hooks-install.test.mjs — P0-04: the tracked-hooks surface. Proves, in a
// throwaway git repo, that install.sh is idempotent and that the two hooks
// refuse what they exist to refuse (a planted secret; a validate failure is
// covered by pre-push delegating to pnpm validate, exercised in CI).

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cwd, cmd, args) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hooks-'));
  run(dir, 'git', ['init', '-q']);
  mkdirSync(join(dir, 'hooks'));
  for (const f of ['pre-commit', 'pre-push', 'install.sh'])
    cpSync(join(REPO, 'hooks', f), join(dir, 'hooks', f));
  return dir;
}

describe('hooks/install.sh (P0-04)', () => {
  let dir;
  beforeEach(() => {
    dir = fixtureRepo();
  });

  it('sets core.hooksPath and is idempotent', () => {
    run(dir, 'bash', ['hooks/install.sh']);
    expect(run(dir, 'git', ['config', 'core.hooksPath']).trim()).toBe('hooks');
    run(dir, 'bash', ['hooks/install.sh']); // second run must not fail
    expect(run(dir, 'git', ['config', 'core.hooksPath']).trim()).toBe('hooks');
  });

  it('pre-commit refuses a staged AWS-shaped secret (FR-S2) in a format-clean file', () => {
    run(dir, 'bash', ['hooks/install.sh']);
    // .txt: outside the prettier extension list, so the refusal below can ONLY
    // come from the secrets scan — the earlier manual proof mislabeled a
    // prettier failure as the secrets path; this fixture cannot repeat that.
    writeFileSync(join(dir, 'creds.txt'), 'key=AKIA' + 'ABCDEFGHIJKLMNOP' + '\n');
    run(dir, 'git', ['add', 'creds.txt']);
    let refused = false,
      msg = '';
    try {
      run(dir, 'git', [
        '-c',
        'user.email=t@t',
        '-c',
        'user.name=t',
        'commit',
        '-qm',
        'x',
      ]);
    } catch (e) {
      refused = true;
      msg = String(e.stderr);
    }
    expect(refused).toBe(true);
    expect(msg).toContain('possible secret');
  });

  it('pre-commit passes a clean commit', () => {
    run(dir, 'bash', ['hooks/install.sh']);
    writeFileSync(join(dir, 'notes.txt'), 'nothing secret here\n');
    run(dir, 'git', ['add', 'notes.txt']);
    run(dir, 'git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'ok']);
    expect(run(dir, 'git', ['log', '--oneline']).trim()).toContain('ok');
  });
});
