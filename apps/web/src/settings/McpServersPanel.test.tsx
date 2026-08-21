// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as settingsApi from './api.js';
import { McpServersPanel } from './McpServersPanel.js';

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return {
    ...actual,
    fetchProjectSettings: vi.fn(),
    putProjectSettings: vi.fn(),
  };
});
const mocked = vi.mocked(settingsApi);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchProjectSettings.mockResolvedValue({});
  mocked.putProjectSettings.mockResolvedValue({} as never);
});
afterEach(cleanup);

/**
 * W14-04. The previous panel wrote a `toolAllowlist` shape NOTHING read —
 * the collected-and-dropped defect (W13-35/W13-48 class). These fixtures
 * pin the panel to the schema the run actually consumes (settings-mcp.ts).
 */
describe('McpServersPanel writes the shape the run reads (W14-04)', () => {
  it('RED FIXTURE: registering a server saves id/command/args/env/roles/requireApproval — the preload schema, not the dead toolAllowlist shape', async () => {
    render(<McpServersPanel projectId="proj-1" />);
    await waitFor(() => screen.getByTestId('mcp-servers-panel'));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Docs Server' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } });
    fireEvent.change(screen.getByLabelText('Arguments'), {
      target: { value: '-y some-mcp' },
    });
    fireEvent.change(screen.getByLabelText(/Environment/), {
      target: { value: 'API_TOKEN=my-registered-secret' },
    });
    fireEvent.change(screen.getByLabelText(/Roles that may use/), {
      target: { value: 'coding-agent' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register server' }));

    await waitFor(() => expect(mocked.putProjectSettings).toHaveBeenCalled());
    const [, payload] = mocked.putProjectSettings.mock.calls[0]!;
    expect(payload).toEqual({
      mcpServers: [
        {
          id: 'docs-server',
          name: 'Docs Server',
          command: 'npx',
          args: ['-y', 'some-mcp'],
          env: { API_TOKEN: 'my-registered-secret' },
          roles: ['coding-agent'],
          requireApproval: true,
        },
      ],
    });
  });

  it('says the Law 8 rule where the temptation is: secret NAMES, never raw keys', async () => {
    render(<McpServersPanel projectId="proj-1" />);
    await waitFor(() => screen.getByTestId('mcp-servers-panel'));
    const hint = screen.getByTestId('mcp-env-hint');
    expect(hint.textContent).toContain('NAME of a secret');
    expect(hint.textContent).toContain('never the key itself');
  });

  it('defines what an MCP server is at first meeting, and what approval means', async () => {
    render(<McpServersPanel projectId="proj-1" />);
    await waitFor(() => screen.getByTestId('mcp-servers-panel'));
    expect(screen.getByText(/lends agents extra tools/)).toBeTruthy();
    expect(
      screen.getByLabelText(/Ask me in the morning queue/),
    ).toBeTruthy();
  });
});
