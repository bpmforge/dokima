/**
 * bootstrap/bundle-age.mjs — P6-16: the stale-bundle notice.
 *
 * Field trace 2026-09-02: an Aug-31 `dist/main.js` silently served three
 * shipped fixes' worth of stale code across four live runs. W9-13's doctrine
 * stands — the packaged bundle is preferred so the person most likely to
 * notice a broken bundle exercises it — but preference must never be
 * SILENCE. In a git source checkout, a bundle older than the checkout's
 * history announces itself, with the age and the exact rebuild command,
 * before any command executes. Real installs (no .git) stay quiet.
 */
import { execFileSync } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {{ bundlePath: string, repoRoot: string,
 *           exec?: (cmd: string, args: string[]) => string }} opts
 * @returns {string|null} the notice, or null when nothing needs saying
 */
export function staleBundleNotice({ bundlePath, repoRoot, exec }) {
  try {
    if (!existsSync(path.join(repoRoot, '.git'))) return null;
    const builtMs = statSync(bundlePath).mtimeMs;
    const run =
      exec ??
      ((cmd, args) => execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf8' }));
    const behind = Number(
      String(
        run('git', [
          'rev-list',
          '--count',
          `--since=${new Date(builtMs).toISOString()}`,
          'HEAD',
        ]),
      ).trim(),
    );
    if (!Number.isFinite(behind) || behind <= 0) return null;
    const days = Math.floor((Date.now() - builtMs) / 86_400_000);
    return (
      `dokima: running the PACKAGED bundle (dist/main.js, built ${new Date(builtMs).toISOString().slice(0, 10)}` +
      `${days > 0 ? `, ${days} day(s) old` : ''}) — the checkout has ${behind} newer commit(s). ` +
      'Rebuild with `pnpm build`, or remove apps/server/dist to run from source.'
    );
  } catch {
    return null; // a notice must never break the boot it decorates
  }
}
