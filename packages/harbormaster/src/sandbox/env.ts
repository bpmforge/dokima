/**
 * Cleaned env for a sandboxed run (SC-07: "cleaned env — no vault handles,
 * no tokens"). The guarantee is structural, not a secret-shaped-string
 * scan: the sandbox never inherits the parent process's ambient env
 * wholesale (which is where CI secrets, provider tokens, or a stray
 * `GITHUB_TOKEN` would leak from) — it starts from an explicit allowlist of
 * the handful of vars a shell command actually needs to run at all, then
 * layers on whatever the caller explicitly opts to pass through.
 */

const SAFE_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TEMP',
  'TMP',
] as const;

export function buildSandboxEnv(
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const base: Record<string, string> = {};
  for (const key of SAFE_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (typeof value === 'string') base[key] = value;
  }
  return { ...base, ...extra };
}
