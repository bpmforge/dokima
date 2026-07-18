import { useState } from 'react';
import { useSettingsList } from './useSettingsList.js';
import type { McpServerRegistration } from './types.js';

export interface McpServersPanelProps {
  projectId: string;
}

/** MCP server registration + per-role tool allowlists (FR-I3 surface, AC2, G-19). The host that actually executes tool calls is W6-04's job (packages/mcp is still a stub) — this registers the config the future host will read. */
export function McpServersPanel({ projectId }: McpServersPanelProps) {
  const { items, error, save } = useSettingsList<McpServerRegistration>(
    projectId,
    'mcpServers',
  );
  const [draft, setDraft] = useState({ name: '', command: '', roles: '' });

  if (!items) {
    return error ? (
      <p role="alert" className="settings__error">
        {error}
      </p>
    ) : (
      <p>Loading…</p>
    );
  }

  const handleAdd = () => {
    if (!draft.name.trim() || !draft.command.trim()) return;
    const roles = draft.roles
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    const registration: McpServerRegistration = {
      id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: draft.name.trim(),
      command: draft.command.trim(),
      toolAllowlist: Object.fromEntries(roles.map((r) => [r, ['*']])),
    };
    void save([...items, registration]);
    setDraft({ name: '', command: '', roles: '' });
  };

  const handleRemove = (id: string) => {
    void save(items.filter((s) => s.id !== id));
  };

  return (
    <section aria-label="MCP Servers" data-testid="mcp-servers-panel">
      <p className="settings__hint">
        Tools surface only for roles listed in a server's allowlist (FR-I3) — a role
        absent here cannot see any of this server's tools. Execution is handled by the MCP
        host (W6-04), outside this settings surface's scope; this registers the config it
        will read.
      </p>
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      <ul className="settings__list">
        {items.map((server) => (
          <li key={server.id} data-testid="mcp-server-row">
            <strong>{server.name}</strong> — <code>{server.command}</code> — roles:{' '}
            {Object.keys(server.toolAllowlist).join(', ') || 'none'}
            <button type="button" onClick={() => handleRemove(server.id)}>
              Remove
            </button>
          </li>
        ))}
        {items.length === 0 && <li>No MCP servers registered yet.</li>}
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
          Launch command / URL
          <input
            value={draft.command}
            onChange={(e) => setDraft({ ...draft, command: e.target.value })}
          />
        </label>
        <label>
          Allowed roles (comma-separated)
          <input
            value={draft.roles}
            onChange={(e) => setDraft({ ...draft, roles: e.target.value })}
            placeholder="coding-agent, challenger"
          />
        </label>
        <button type="submit">Register server</button>
      </form>
    </section>
  );
}
