/**
 * SC-08: localhost-only Host/Origin allowlist. Exact `localhost:<port>` /
 * `127.0.0.1:<port>` matches only — no wildcards, no CORS headers served at
 * all. Defeats DNS rebinding (evil Host header) and cross-site localhost
 * CSRF (evil Origin header) alike.
 */

export interface Allowlist {
  hosts: ReadonlySet<string>;
  origins: ReadonlySet<string>;
}

export function buildAllowlist(port: number): Allowlist {
  return {
    hosts: new Set([`127.0.0.1:${port}`, `localhost:${port}`]),
    origins: new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]),
  };
}

export function isAllowedHost(host: string | undefined, allowlist: Allowlist): boolean {
  return host !== undefined && allowlist.hosts.has(host);
}

/** Origin is optional on same-machine, non-browser requests (curl, CLI) — only reject a present-but-wrong value. */
export function isAllowedOrigin(
  origin: string | undefined,
  allowlist: Allowlist,
): boolean {
  return origin === undefined || allowlist.origins.has(origin);
}
