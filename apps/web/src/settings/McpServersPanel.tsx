import { useState } from 'react';
import { useSettingsList } from './useSettingsList.js';
import type { McpServerEntry } from './types.js';

export interface McpServersPanelProps {
  projectId: string;
}

/**
 * MCP servers (W14-04, FR-I3). REWRITTEN from the W4-06 stub, which wrote a
 * `toolAllowlist` shape nothing ever read — the exact collected-and-dropped
 * defect W13-35/W13-48 removed elsewhere. This panel writes the schema the
 * run actually consumes (`settings-mcp.ts`): preload spawns the command at
 * run start, discovers its tools, and grants them to the roles listed here;
 * every tool call still needs a morning-queue approval unless the approval
 * requirement is switched off per server.
 */
export function McpServersPanel({ projectId }: McpServersPanelProps) {
  const { items, error, save } = useSettingsList<McpServerEntry>(projectId, 'mcpServers');
  const [draft, setDraft] = useState({
    name: '',
    command: '',
    args: '',
    env: '',
    roles: 'coding-agent',
    requireApproval: true,
  });

  if (!items) {
    return error ? (
      <p role="alert" className="settings__error">
        {error}
      </p>
    ) : (
      <p>Loading…</p>
    );
  }

  const slugOf = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);

  const handleAdd = () => {
    if (!draft.name.trim() || !draft.command.trim()) return;
    const env: Record<string, string> = {};
    for (const line of draft.env.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    const entry: McpServerEntry = {
      id: slugOf(draft.name),
      name: draft.name.trim(),
      command: draft.command.trim(),
      args: draft.args.trim() ? draft.args.trim().split(/\s+/) : [],
      ...(Object.keys(env).length > 0 ? { env } : {}),
      roles: draft.roles
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean),
      requireApproval: draft.requireApproval,
    };
    void save([...items.filter((s) => s.id !== entry.id), entry]);
    setDraft({
      name: '',
      command: '',
      args: '',
      env: '',
      roles: 'coding-agent',
      requireApproval: true,
    });
  };

  return (
    <section aria-label="MCP servers" data-testid="mcp-servers-panel">
      {/* Defined at first meeting (VOCABULARY.md rule). */}
      <p className="settings__hint">
        An MCP server is a small program that lends agents extra tools — a
        docs search, a deploy hook, an issue tracker. Register one here and
        every run starts it, discovers its tools, and offers them only to the
        roles you list. Each tool call waits for your approval in the morning
        queue unless you switch that off for a server you trust.
      </p>
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      <ul className="settings__list">
        {items.map((server) => (
          <li key={server.id} data-testid="mcp-server-row">
            <strong>{server.name ?? server.id}</strong> —{' '}
            <code>
              {server.command} {(server.args ?? []).join(' ')}
            </code>{' '}
            — roles: {(server.roles ?? []).join(', ') || 'none (no agent sees its tools)'} —{' '}
            {server.requireApproval === false
              ? 'runs without asking'
              : 'every call asks first'}
            <button
              type="button"
              onClick={() => void save(items.filter((s) => s.id !== server.id))}
            >
              Remove
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li>No MCP servers registered yet — agents have their built-in tools only.</li>
        )}
      </ul>
      <form
        className="settings__row-form"
        aria-label="Register MCP server"
        onSubmit={(e) => {
          e.preventDefault();
          handleAdd();
        }}
      >
        <label>
          Name
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          Command
          <input
            value={draft.command}
            onChange={(e) => setDraft({ ...draft, command: e.target.value })}
            placeholder="npx"
          />
        </label>
        <label>
          Arguments
          <input
            value={draft.args}
            onChange={(e) => setDraft({ ...draft, args: e.target.value })}
            placeholder="-y some-mcp-server"
          />
        </label>
        <label>
          Environment (one KEY=secret-name per line)
          <textarea
            value={draft.env}
            onChange={(e) => setDraft({ ...draft, env: e.target.value })}
            placeholder={'API_TOKEN=my-registered-secret'}
            rows={2}
          />
        </label>
        {/* Law 8, said where the temptation is: */}
        <p className="settings__hint" data-testid="mcp-env-hint">
          Use the NAME of a secret from the project vault, never the key
          itself — a raw key typed here is refused when the run starts.
        </p>
        <label>
          Roles that may use its tools (comma-separated)
          <input
            value={draft.roles}
            onChange={(e) => setDraft({ ...draft, roles: e.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.requireApproval}
            onChange={(e) => setDraft({ ...draft, requireApproval: e.target.checked })}
          />{' '}
          Ask me in the morning queue before any of its tools run
        </label>
        <button type="submit">Register server</button>
      </form>
    </section>
  );
}
