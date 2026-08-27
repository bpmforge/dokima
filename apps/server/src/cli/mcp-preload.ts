/**
 * MCP server preloading (W14-02, FR-I3): the first production reader the
 * `mcpServers` settings key has ever had. At run start every configured
 * server is spawned via the W14-01 stdio client, its tools discovered and
 * registered into the project's event log, and one composed ToolExecutor
 * routes `<serverId>.<tool>` calls to the live client pool. W14-03 puts
 * these tools in front of agent sessions; this module only makes them real.
 *
 * DEGRADES HONESTLY (FR-G5): a server that fails to spawn, initialize, or
 * list is disposed, ledgered (`mcp.server_preload_failed`), and reported
 * once on stderr — the run proceeds with the servers that work. A silent
 * absence is the defect class this wave exists to end; a crashed run over
 * one bad entry would be worse.
 *
 * Law 8: `env` values in settings are vault secret NAMES. They resolve
 * through the injected resolver at spawn time; the resolved value goes only
 * into the child's environment, never into events, stderr, or errors —
 * `appendEvent` additionally redacts via `secretValues` as a backstop.
 */

import { appendEvent, type EventLog } from '@dokima/events';
import {
  createStdioToolExecutor,
  discoveredToolDefinitions,
  getServer,
  listToolsForRole,
  loadMcpState,
  registerServer,
  setRoleAllowlist,
  spawnStdioMcpClient,
  type McpClient,
  type ToolExecutor,
} from '@dokima/mcp';
import {
  parseMcpServersSetting,
  type McpServerSetting,
} from '../api/server/settings-types.js';

export interface McpPreloadFailure {
  readonly serverId: string;
  readonly reason: string;
}

export interface McpPreloadResult {
  readonly clients: ReadonlyMap<string, McpClient>;
  readonly executor: ToolExecutor;
  /** Tool ids registered and live this run, `<serverId>.<tool>`. */
  readonly toolIds: readonly string[];
  readonly failures: readonly McpPreloadFailure[];
  dispose(): void;
}

export interface PreloadMcpServersOptions {
  readonly log: EventLog;
  readonly actorId: string;
  readonly runId: string;
  readonly servers: readonly McpServerSetting[];
  /** Vault secret name -> value; undefined = not registered (that server fails honestly). */
  readonly resolveSecret: (name: string) => Promise<string | undefined>;
  readonly stderr: (line: string) => void;
  readonly secretValues: readonly string[];
  /** Injected for tests (Law 9a: unit tests never spawn what they can fake). */
  readonly spawnClient?: typeof spawnStdioMcpClient;
}

export async function preloadMcpServers(
  options: PreloadMcpServersOptions,
): Promise<McpPreloadResult> {
  const spawnClient = options.spawnClient ?? spawnStdioMcpClient;
  const clients = new Map<string, McpClient>();
  const failures: McpPreloadFailure[] = [];
  const toolIds: string[] = [];

  const fail = (serverId: string, reason: string, client?: McpClient) => {
    client?.dispose();
    failures.push({ serverId, reason });
    appendEvent(
      options.log,
      {
        eventType: 'mcp.server_preload_failed',
        actorId: options.actorId,
        runId: options.runId,
        payload: { serverId, reason },
      },
      { secretValues: options.secretValues },
    );
    options.stderr(
      `[mcp] server ${serverId} was not preloaded: ${reason} — the run continues without it`,
    );
  };

  for (const server of options.servers) {
    // Resolve env refs first: a missing secret is a configuration fact the
    // operator can fix, and spawning without it would hand the server an
    // empty credential and a confusing downstream failure.
    const env: Record<string, string> = {};
    let envOk = true;
    for (const [key, ref] of Object.entries(server.env ?? {})) {
      const value = await options.resolveSecret(ref);
      if (value === undefined) {
        fail(
          server.id,
          `env ${key} references vault secret "${ref}", which is not registered`,
        );
        envOk = false;
        break;
      }
      env[key] = value;
    }
    if (!envOk) continue;

    const client = spawnClient({
      id: server.id,
      command: server.command,
      args: server.args ?? [],
      ...(Object.keys(env).length > 0 ? { env } : {}),
    });
    try {
      await client.initialize();
      const discovered = await client.listTools();
      const definitions = discoveredToolDefinitions(server.id, discovered).map(
        (definition) => ({
          ...definition,
          // W14-04: the owner's per-server choice; absent = ask (SC-12).
          requiresApproval: server.requireApproval !== false,
        }),
      );
      // Idempotent across runs, the ensureAgentSessionToolsRegistered
      // tolerance: the log already knows this server from a prior run.
      if (!getServer(options.log, server.id)) {
        registerServer(options.log, {
          id: server.id,
          name: server.name ?? server.id,
          transport: 'stdio',
          command: server.command,
          args: server.args ?? [],
          tools: definitions.map(({ id, name, description, requiresApproval }) => ({
            id,
            name,
            description,
            requiresApproval,
          })),
          actorId: options.actorId,
        });
      }
      clients.set(server.id, client);
      toolIds.push(...definitions.map((d) => d.id));
    } catch (err) {
      fail(server.id, err instanceof Error ? err.message : String(err), client);
    }
  }

  syncRoleGrants(options.log, options.actorId, options.servers, toolIds);

  return {
    clients,
    executor: createStdioToolExecutor(clients),
    toolIds,
    failures,
    dispose() {
      for (const [, client] of clients) client.dispose();
      clients.clear();
    },
  };
}

/**
 * Settings -> allowlist reconciliation (W14-04): the panel's `roles` list is
 * the source of truth for which roles see a configured server's tools. Runs
 * after preload so only LIVE tool ids are granted. Grants for servers this
 * settings file does not mention are left alone (a manual or test grant is
 * not ours to revoke), and the closed agent-session set is untouched.
 */
function syncRoleGrants(
  log: Parameters<typeof setRoleAllowlist>[0],
  actorId: string,
  servers: readonly McpServerSetting[],
  liveToolIds: readonly string[],
): void {
  const live = new Set(liveToolIds);
  const configuredPrefixes = servers.map((server) => `${server.id}.`);
  const ownedBySettings = (toolId: string) =>
    configuredPrefixes.some((prefix) => toolId.startsWith(prefix));

  const desiredByRole = new Map<string, Set<string>>();
  for (const server of servers) {
    for (const role of server.roles ?? []) {
      const set = desiredByRole.get(role) ?? new Set<string>();
      for (const toolId of live) {
        if (toolId.startsWith(`${server.id}.`)) set.add(toolId);
      }
      desiredByRole.set(role, set);
    }
  }

  const roles = new Set<string>([
    ...desiredByRole.keys(),
    ...loadMcpState(log).allowlist.keys(),
  ]);
  for (const role of roles) {
    const current = listToolsForRole(log, role).map((tool) => tool.id);
    const kept = current.filter((id) => !ownedBySettings(id));
    const desired = [...(desiredByRole.get(role) ?? new Set<string>())];
    const next = [...new Set([...kept, ...desired])].sort();
    if (next.join('\n') !== [...current].sort().join('\n')) {
      setRoleAllowlist(log, { role, toolIds: next, actorId });
    }
  }
}

/**
 * W21-38 chapter (CODE_BOOK_PROTOCOL 400-line cap): the settings-read half of
 * the MCP preload, moved out of `run-build.ts` verbatim when adding the
 * required-validators setting pushed that file over the cap for the fourth
 * time this wave. A move, not a rewrite — the refusal and the preload are
 * unchanged, they simply live with the module that owns them.
 */
export async function preloadMcpFromSettings(input: {
  readonly log: Parameters<typeof preloadMcpServers>[0]['log'];
  readonly actorId: string;
  readonly runId: string;
  readonly settingValue: unknown;
  readonly isSecretLike: (value: string) => boolean;
  readonly resolveSecret: (name: string) => Promise<string | undefined>;
  readonly stderr: (line: string) => void;
  readonly secretValues: readonly string[];
}): Promise<{ readonly preload: McpPreloadResult } | { readonly refusal: string }> {
  const setting = parseMcpServersSetting(input.settingValue, input.isSecretLike);
  if ('refusal' in setting) return { refusal: setting.refusal };
  const preload = await preloadMcpServers({
    log: input.log,
    actorId: input.actorId,
    runId: input.runId,
    servers: setting.servers,
    resolveSecret: input.resolveSecret,
    stderr: input.stderr,
    secretValues: input.secretValues,
  });
  return { preload };
}
