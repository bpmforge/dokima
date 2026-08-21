/**
 * `mcpServers` settings schema (W14-02, FR-I3/US-503). This key spent its
 * life as an untyped passthrough the composition-root comment listed and
 * nothing read; preloading (cli/mcp-preload.ts) is its first reader, so it
 * gets a real shape and a refusing parser the same day.
 *
 * `env` values are CREDENTIAL REFS — names in the project's secrets vault —
 * never raw secrets (Law 8, FR-S2). The parser refuses a value matching a
 * known live-credential shape outright: a secret typed here would land in a
 * settings file on disk, which is exactly what the vault exists to prevent.
 */
export const MCP_SERVERS_SETTINGS_KEY = 'mcpServers';

export interface McpServerSetting {
  readonly id: string;
  readonly name?: string;
  readonly command: string;
  readonly args?: readonly string[];
  /** env var name -> vault secret NAME (a ref), resolved at spawn time. */
  readonly env?: Readonly<Record<string, string>>;
}

export type McpServersParseResult =
  | { readonly servers: readonly McpServerSetting[] }
  | { readonly refusal: string };

const MCP_SERVER_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function parseMcpServersSetting(
  raw: unknown,
  looksLikeSecret: (value: string) => boolean,
): McpServersParseResult {
  if (raw === undefined || raw === null) return { servers: [] };
  if (!Array.isArray(raw)) {
    return { refusal: `mcpServers must be an array of server entries` };
  }
  const servers: McpServerSetting[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      return { refusal: 'mcpServers entries must be objects' };
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || !MCP_SERVER_ID_RE.test(e.id)) {
      return {
        refusal: `mcpServers entry has a missing or invalid id (lowercase slug, max 64 chars)`,
      };
    }
    if (seen.has(e.id)) return { refusal: `mcpServers id "${e.id}" appears twice` };
    seen.add(e.id);
    if (typeof e.command !== 'string' || e.command.trim() === '') {
      return { refusal: `mcpServers entry "${e.id}" has no command` };
    }
    const args: string[] = [];
    if (e.args !== undefined) {
      if (!Array.isArray(e.args) || e.args.some((a) => typeof a !== 'string')) {
        return { refusal: `mcpServers entry "${e.id}" args must be strings` };
      }
      args.push(...(e.args as string[]));
    }
    let env: Record<string, string> | undefined;
    if (e.env !== undefined) {
      if (typeof e.env !== 'object' || e.env === null || Array.isArray(e.env)) {
        return { refusal: `mcpServers entry "${e.id}" env must be an object of refs` };
      }
      env = {};
      for (const [key, value] of Object.entries(e.env as Record<string, unknown>)) {
        if (typeof value !== 'string') {
          return { refusal: `mcpServers entry "${e.id}" env.${key} must be a string ref` };
        }
        if (looksLikeSecret(value)) {
          return {
            refusal:
              `mcpServers entry "${e.id}" env.${key} looks like a raw credential — ` +
              `register the secret in the project vault and put its NAME here (Law 8)`,
          };
        }
        env[key] = value;
      }
    }
    servers.push({
      id: e.id,
      ...(typeof e.name === 'string' ? { name: e.name } : {}),
      command: e.command,
      args,
      ...(env ? { env } : {}),
    });
  }
  return { servers };
}
