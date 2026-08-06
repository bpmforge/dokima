// @vitest-environment jsdom
/**
 * DOM coverage for AgentRunnerPanel (W11-04, FR-H6, D-023). Every component
 * here calls the real settings client (api.ts) against a stubbed
 * `global.fetch` (never the real network, Law 9) — same technique as
 * ProvidersPanel.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentRunnerPanel } from './AgentRunnerPanel.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function method(init?: RequestInit): string {
  return init?.method ?? 'GET';
}

interface Route {
  match: (url: string, init?: RequestInit) => boolean;
  handle: (url: string, init?: RequestInit) => Response | Promise<Response>;
}

function router(routes: Route[]): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const route of routes) {
      if (route.match(url, init)) return route.handle(url, init);
    }
    throw new Error(`unmocked fetch: ${method(init)} ${url}`);
  });
}

const getEffective = (respond: () => Response) => ({
  match: (u: string, i?: RequestInit) =>
    method(i) === 'GET' && u.endsWith('/settings/effective'),
  handle: respond,
});
const getProjectSettingsRoute = (respond: () => Response) => ({
  match: (u: string, i?: RequestInit) =>
    method(i) === 'GET' && /\/projects\/[^/]+\/settings$/.test(u),
  handle: respond,
});
const putProjectSettingsRoute = (
  handle: (body: Record<string, unknown>) => Response,
) => ({
  match: (u: string, i?: RequestInit) =>
    method(i) === 'PUT' && /\/projects\/[^/]+\/settings$/.test(u),
  handle: (_u: string, i?: RequestInit) => handle(JSON.parse(i!.body as string)),
});
const getGlobalSettingsRoute = (respond: () => Response) => ({
  match: (u: string, i?: RequestInit) =>
    method(i) === 'GET' && u.endsWith('/settings/global'),
  handle: respond,
});
const putGlobalSettingsRoute = (handle: (body: Record<string, unknown>) => Response) => ({
  match: (u: string, i?: RequestInit) =>
    method(i) === 'PUT' && u.endsWith('/settings/global'),
  handle: (_u: string, i?: RequestInit) => handle(JSON.parse(i!.body as string)),
});

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  cleanup();
  fetchSpy.mockRestore();
  vi.restoreAllMocks();
});

describe('AgentRunnerPanel (acceptance 2/3, RED FIXTURE)', () => {
  it('RED FIXTURE: a project with no agentRunner setting shows the built-in default, not a refusal', async () => {
    fetchSpy.mockImplementation(router([getEffective(() => jsonResponse({}))]));
    render(<AgentRunnerPanel projectId="p1" />);
    await screen.findByTestId('agent-runner-current');
    expect(screen.getByTestId('agent-runner-current').textContent).toContain('built-in');
    expect(screen.queryByTestId('external-agent-warning')).toBeNull();
  });

  it('shows the effective winning scope when a value is set', async () => {
    fetchSpy.mockImplementation(
      router([
        getEffective(() =>
          jsonResponse({
            agentRunner: {
              value: { kind: 'external', command: 'opencode -p' },
              winning_scope: 'project',
              overridden: [],
            },
          }),
        ),
      ]),
    );
    render(<AgentRunnerPanel projectId="p1" />);
    await screen.findByTestId('agent-runner-current');
    expect(screen.getByTestId('agent-runner-current').textContent).toContain('external');
    expect(screen.getByTestId('agent-runner-current').textContent).toContain(
      'opencode -p',
    );
    expect(screen.getByTestId('agent-runner-effective-scope').textContent).toContain(
      'project',
    );
  });

  it('RED FIXTURE (acceptance 2): selecting external shows the bypass warning, asserted by exact content, not just presence', async () => {
    fetchSpy.mockImplementation(router([getEffective(() => jsonResponse({}))]));
    render(<AgentRunnerPanel projectId="p1" />);
    await screen.findByTestId('agent-runner-current');

    fireEvent.change(screen.getByLabelText('Runner'), { target: { value: 'external' } });

    const warning = await screen.findByTestId('external-agent-warning');
    expect(warning.textContent).toMatch(/tokens are spent somewhere Dokima cannot see/i);
    expect(warning.textContent).toMatch(/role.{0,10}model matrix/i);
    expect(warning.textContent).toMatch(/escalation ladder/i);
    expect(warning.textContent).toMatch(/budget breaker/i);
    expect(warning.textContent).toMatch(/spend ledger/i);
  });

  it('refuses to save an external runner with no command typed in', async () => {
    fetchSpy.mockImplementation(router([getEffective(() => jsonResponse({}))]));
    render(<AgentRunnerPanel projectId="p1" />);
    await screen.findByTestId('agent-runner-current');

    fireEvent.change(screen.getByLabelText('Runner'), { target: { value: 'external' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save agent runner' }));

    await screen.findByText(/an external agent requires a command/i);
  });

  it('saves a project-scoped external command', async () => {
    let putBody: Record<string, unknown> | undefined;
    fetchSpy.mockImplementation(
      router([
        getEffective(() => jsonResponse({})),
        getProjectSettingsRoute(() => jsonResponse({})),
        putProjectSettingsRoute((body) => {
          putBody = body;
          return jsonResponse(body);
        }),
      ]),
    );
    render(<AgentRunnerPanel projectId="p1" />);
    await screen.findByTestId('agent-runner-current');

    fireEvent.change(screen.getByLabelText('Runner'), { target: { value: 'external' } });
    fireEvent.change(screen.getByLabelText('Command'), {
      target: { value: 'opencode -p' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save agent runner' }));

    await vi.waitFor(() => expect(putBody).toBeDefined());
    expect(putBody?.agentRunner).toEqual({ kind: 'external', command: 'opencode -p' });
  });

  it('saves to global scope when "Use for every project" is checked', async () => {
    let putBody: Record<string, unknown> | undefined;
    fetchSpy.mockImplementation(
      router([
        getEffective(() => jsonResponse({})),
        getGlobalSettingsRoute(() => jsonResponse({})),
        putGlobalSettingsRoute((body) => {
          putBody = body;
          return jsonResponse(body);
        }),
      ]),
    );
    render(<AgentRunnerPanel projectId="p1" />);
    await screen.findByTestId('agent-runner-current');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Use for every project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save agent runner' }));

    await vi.waitFor(() => expect(putBody).toBeDefined());
    expect(putBody?.agentRunner).toEqual({ kind: 'built-in' });
  });
});
