/**
 * P6-16: the stale-bundle notice. RED provenance: an Aug-31 bundle silently
 * served stale code across four live runs (2026-09-02 field trace) — the
 * entry preferred it by doctrine (W9-13) and said nothing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-node .mjs chapter, no emitted types
import { staleBundleNotice } from './bundle-age.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function scratch(withGit: boolean): { root: string; bundle: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dokima-p616-'));
  dirs.push(root);
  if (withGit) fs.mkdirSync(path.join(root, '.git'));
  const bundle = path.join(root, 'main.js');
  fs.writeFileSync(bundle, '// bundle');
  return { root, bundle };
}

describe('staleBundleNotice (P6-16)', () => {
  it('a bundle with newer commits behind it ANNOUNCES itself with age and the rebuild command', () => {
    const { root, bundle } = scratch(true);
    const old = Date.now() - 3 * 86_400_000;
    fs.utimesSync(bundle, old / 1000, old / 1000);
    const notice = staleBundleNotice({
      bundlePath: bundle,
      repoRoot: root,
      exec: () => '7\n', // 7 commits since the build
    });
    expect(notice).toContain('PACKAGED bundle');
    expect(notice).toContain('7 newer commit(s)');
    expect(notice).toContain('pnpm build');
    expect(notice).toContain('day(s) old');
  });

  it('a fresh bundle (zero commits since the build) says nothing', () => {
    const { root, bundle } = scratch(true);
    expect(
      staleBundleNotice({ bundlePath: bundle, repoRoot: root, exec: () => '0\n' }),
    ).toBeNull();
  });

  it('a real install (no .git) stays quiet — no noise for customers', () => {
    const { root, bundle } = scratch(false);
    expect(
      staleBundleNotice({
        bundlePath: bundle,
        repoRoot: root,
        exec: () => {
          throw new Error('must not be called');
        },
      }),
    ).toBeNull();
  });

  it('a broken git never breaks the boot — the notice degrades to silence', () => {
    const { root, bundle } = scratch(true);
    expect(
      staleBundleNotice({
        bundlePath: bundle,
        repoRoot: root,
        exec: () => {
          throw new Error('git exploded');
        },
      }),
    ).toBeNull();
  });
});
