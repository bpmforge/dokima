// @vitest-environment jsdom
/**
 * DOM coverage for ProvidersPanel AND for ModelMatrixPanel's model-picker
 * behavior (AC1 "select from a LIST", AC2 maker!=verifier inline refusal):
 * ModelMatrixPanel.tsx has no test-sibling in this ticket's write_scope, and
 * it composes ProvidersPanel directly (UX_SPEC §6a's "[ Providers ]" then
 * "[ Models ]" stacked in one Settings panel), so its behavior is exercised
 * here instead, under its own `describe` block, rather than left untested.
 *
 * Every component here calls the real providers-api.ts / api.ts client
 * functions against a stubbed `global.fetch` (never the real network, Law
 * 9) — same technique as board/drawer/EvidencePanel.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProvidersPanel } from './ProvidersPanel.js';
import { ModelMatrixPanel } from './ModelMatrixPanel.js';

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

const getProviders = (respond: () => Response) => ({
  match: (u: string, i?: RequestInit) => method(i) === 'GET' && u.endsWith('/providers'),
  handle: respond,
});
const putProvidersRoute = (handle: (body: { providers: unknown[] }) => Response) => ({
  match: (u: string, i?: RequestInit) => method(i) === 'PUT' && u.endsWith('/providers'),
  handle: (_u: string, i?: RequestInit) => handle(JSON.parse(i!.body as string)),
});
const getModels = (respond: (providerId: string) => Response) => ({
  match: (u: string, i?: RequestInit) =>
    method(i) === 'GET' && /\/providers\/[^/]+\/models$/.test(u),
  handle: (u: string) => respond(/\/providers\/([^/]+)\/models$/.exec(u)![1]!),
});
const postCredentials = (
  handle: (body: { name: string; value: string }) => Response,
) => ({
  match: (u: string, i?: RequestInit) =>
    method(i) === 'POST' && u.endsWith('/providers/credentials'),
  handle: (_u: string, i?: RequestInit) => handle(JSON.parse(i!.body as string)),
});
const deleteProviderRoute = (respond: () => Response) => ({
  match: (u: string, i?: RequestInit) =>
    method(i) === 'DELETE' && /\/providers\/[^/]+$/.test(u),
  handle: respond,
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

describe('ProvidersPanel empty + registration states (AC1, AC2 states table)', () => {
  it('shows the exact UX_SPEC §6a empty state when no providers are registered', async () => {
    fetchSpy.mockImplementation(
      router([getProviders(() => jsonResponse({ providers: [] }))]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText(/No providers yet\. Dokima runs fully local/);
  });

  it('registers an ollama provider with the prefilled local default base URL, then auto-tests it', async () => {
    let putBody:
      { providers: { id: string; kind: string; base_url?: string }[] } | undefined;
    fetchSpy.mockImplementation(
      router([
        getProviders(() => jsonResponse({ providers: [] })),
        putProvidersRoute((body) => {
          putBody = body as typeof putBody;
          return jsonResponse({ providers: body.providers });
        }),
        getModels(() => jsonResponse({ status: 'ok', source: 'discovered', models: [] })),
      ]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText(/No providers yet/);

    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'ollama-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    await screen.findByText('ollama-1');
    expect(putBody?.providers).toEqual([
      {
        id: 'ollama-1',
        kind: 'ollama',
        base_url: 'http://localhost:11434/v1',
        enabled: true,
      },
    ]);
  });

  it('surfaces a 403 consent-required refusal inline in the Add form for an unconsented copilot kind', async () => {
    fetchSpy.mockImplementation(
      router([
        getProviders(() => jsonResponse({ providers: [] })),
        putProvidersRoute(() =>
          jsonResponse(
            {
              detail:
                'kind "copilot" requires an explicit, ledgered consent acknowledgement before it can be enabled (D-019)',
              rule: 'consent-required',
            },
            403,
          ),
        ),
      ]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText(/No providers yet/);

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'copilot' } });
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'copilot-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('consent acknowledgement');
  });

  it('client-side refuses an invalid id before any network call, matching the server rule text', async () => {
    fetchSpy.mockImplementation(
      router([getProviders(() => jsonResponse({ providers: [] }))]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText(/No providers yet/);

    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'Not Valid!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('lowercase alphanumeric with dashes');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the initial GET — no PUT attempted
  });
});

describe('ProvidersPanel reachability states (UX_SPEC §6a "every state, written")', () => {
  const ENTRY = {
    id: 'lm1',
    kind: 'lm-studio',
    base_url: 'http://localhost:1234/v1',
    enabled: true,
  };

  it('Test resolves to the Bundled chip with its reason for an unreachable endpoint with a bundled fallback', async () => {
    fetchSpy.mockImplementation(
      router([
        getProviders(() => jsonResponse({ providers: [ENTRY] })),
        getModels(() =>
          jsonResponse({
            status: 'unreachable',
            source: 'bundled',
            models: [{ id: 'qwen2.5-coder-7b-instruct' }],
            reason: 'connect ECONNREFUSED 127.0.0.1:1234',
          }),
        ),
      ]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText('lm1');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await screen.findByText('Bundled');
    await screen.findByText(/connect ECONNREFUSED/);
  });

  it('Test resolves to Unreachable with source null and no bundled fallback (honest-absence, W9-15)', async () => {
    fetchSpy.mockImplementation(
      router([
        getProviders(() => jsonResponse({ providers: [ENTRY] })),
        getModels(() =>
          jsonResponse({
            status: 'unreachable',
            source: null,
            models: [],
            reason: 'timeout',
          }),
        ),
      ]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText('lm1');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await screen.findByText('Unreachable');
    await screen.findByText('timeout');
  });

  it('"Discovery returned nothing": Reachable but zero models shows the pull/load hint', async () => {
    fetchSpy.mockImplementation(
      router([
        getProviders(() => jsonResponse({ providers: [ENTRY] })),
        getModels(() => jsonResponse({ status: 'ok', source: 'discovered', models: [] })),
      ]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText('lm1');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await screen.findByText('Reachable');
    await screen.findByText(/serves no models yet/);
  });

  it('"Cloud kind selected": the not-yet-constructible reason renders verbatim', async () => {
    const CLOUD_ENTRY = { id: 'oa1', kind: 'openai', enabled: true };
    fetchSpy.mockImplementation(
      router([
        getProviders(() => jsonResponse({ providers: [CLOUD_ENTRY] })),
        getModels(() =>
          jsonResponse({
            status: 'unreachable',
            source: null,
            models: [],
            reason:
              'provider kind "openai" is registered but not yet constructible from the pipeline: it needs a resolved credential and a real price table (W10 follow-up). Local kinds (ollama, lm-studio, oai-compat) work today.',
          }),
        ),
      ]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText('oa1');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await screen.findByText(/not yet constructible from the pipeline/);
  });
});

describe('ProvidersPanel remove (UX_SPEC §6a exact removal copy, C-6)', () => {
  const ENTRY = {
    id: 'gone',
    kind: 'ollama',
    enabled: true,
    credential_ref: 'gone-credential',
  };

  it('names the id and the keychain ref in the confirm, and only calls DELETE when confirmed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fetchSpy.mockImplementation(
      router([
        getProviders(() => jsonResponse({ providers: [ENTRY] })),
        deleteProviderRoute(() => ({ ok: true, status: 204 }) as Response),
      ]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText('gone');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Remove gone?'));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('gone-credential'));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('append-only (C-6)'));
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/providers/gone'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('does nothing when the removal confirm is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fetchSpy.mockImplementation(
      router([getProviders(() => jsonResponse({ providers: [ENTRY] }))]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText('gone');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('/providers/gone'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('ProvidersPanel credential handling (Law 8 / FR-S2 red fixture)', () => {
  it('sends the literal API key only to the credentials endpoint — the providers PUT carries the returned ref, never the literal', async () => {
    const SECRET = 'sk-super-secret-abcdefghijklmnop';
    let credentialsBody: { name: string; value: string } | undefined;
    let putBody: { providers: { credential_ref?: string }[] } | undefined;
    fetchSpy.mockImplementation(
      router([
        getProviders(() => jsonResponse({ providers: [] })),
        postCredentials((body) => {
          credentialsBody = body;
          return jsonResponse({ ref: 'oai1-credential' });
        }),
        putProvidersRoute((body) => {
          putBody = body as typeof putBody;
          return jsonResponse({ providers: body.providers });
        }),
        getModels(() => jsonResponse({ status: 'ok', source: 'discovered', models: [] })),
      ]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText(/No providers yet/);

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'oai-compat' } });
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'oai1' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com/v1' },
    });
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    await screen.findByText('oai1');

    expect(credentialsBody).toEqual({ name: 'oai1-credential', value: SECRET });
    expect(putBody?.providers[0]?.credential_ref).toBe('oai1-credential');
    expect(JSON.stringify(putBody)).not.toContain(SECRET);
  });

  it('never attempts the providers PUT at all when the keychain write fails — no fallback to the literal', async () => {
    const SECRET = 'sk-another-secret-0123456789abcd';
    fetchSpy.mockImplementation(
      router([
        getProviders(() => jsonResponse({ providers: [] })),
        postCredentials(() => jsonResponse({ detail: 'keychain unavailable' }, 500)),
      ]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText(/No providers yet/);

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'oai-compat' } });
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'oai2' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com/v1' },
    });
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    await screen.findByRole('alert');
    const putCalls = fetchSpy.mock.calls.filter(([, init]) => method(init) === 'PUT');
    expect(putCalls).toHaveLength(0);
  });
});

describe('ModelMatrixPanel model picker (AC1 "select from a LIST", composed via ProvidersPanel above it)', () => {
  function matrixWire(rows: unknown[], copilotEnabled = false) {
    return jsonResponse({ rows, copilot_enabled: copilotEnabled });
  }

  const getMatrix = (respond: () => Response) => ({
    match: (u: string, i?: RequestInit) =>
      method(i) === 'GET' && u.endsWith('/model-matrix'),
    handle: respond,
  });
  const putMatrix = (handle: (body: { rows: unknown[] }) => Response) => ({
    match: (u: string, i?: RequestInit) =>
      method(i) === 'PUT' && u.endsWith('/model-matrix'),
    handle: (_u: string, i?: RequestInit) => handle(JSON.parse(i!.body as string)),
  });

  it('offers the discovered/bundled catalog as a datalist on the Model field, kept a fillable text input (backward compatible with the existing free-text e2e flow)', async () => {
    fetchSpy.mockImplementation(
      router([
        getProviders(() =>
          jsonResponse({ providers: [{ id: 'ollama1', kind: 'ollama', enabled: true }] }),
        ),
        getModels(() =>
          jsonResponse({
            status: 'ok',
            source: 'discovered',
            models: [{ id: 'qwen2.5-coder-7b' }],
          }),
        ),
        getMatrix(() => matrixWire([])),
      ]),
    );
    render(<ModelMatrixPanel projectId="p1" />);
    await screen.findByText('ollama1');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    const modelInput = await screen.findByLabelText('Model');
    expect(modelInput.getAttribute('list')).toBe('model-matrix-catalog');
    await vi.waitFor(() => {
      expect(
        document.querySelector('#model-matrix-catalog option[value="qwen2.5-coder-7b"]'),
      ).not.toBeNull();
    });
    // still a plain fillable text input, not a <select> — existing e2e relies on .fill()
    expect(modelInput.tagName).toBe('INPUT');
  });

  it('explains a maker!=verifier refusal inline, verbatim, for a brand-new row with no existing table row yet (AC2)', async () => {
    fetchSpy.mockImplementation(
      router([
        getProviders(() => jsonResponse({ providers: [] })),
        getMatrix(() =>
          matrixWire([
            {
              role: 'coding-agent',
              task_type: 'code',
              model: 'local/qwen',
              fallback: [],
              updated_at: '2026-08-01T00:00:00Z',
              copilot_backed: false,
            },
          ]),
        ),
        putMatrix(() =>
          jsonResponse(
            {
              detail:
                "refusing to route 'challenger' to 'local/qwen' — same model as maker role 'coding-agent'; set an explicit override to allow it",
              rule: 'same-model-refused',
            },
            409,
          ),
        ),
      ]),
    );
    render(<ModelMatrixPanel projectId="p1" />);
    await screen.findByText(/No providers yet/);

    const form = screen.getByRole('form', { name: 'Add matrix row' });
    fireEvent.change(form.querySelector('input[placeholder="coding-agent"]')!, {
      target: { value: 'challenger' },
    });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'local/qwen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add / update row' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      "refusing to route 'challenger' to 'local/qwen' — same model as maker role 'coding-agent'; set an explicit override to allow it",
    );
  });

  it('marks a row "missing from <provider>" when its stored model is no longer in any known catalog', async () => {
    fetchSpy.mockImplementation(
      router([
        getProviders(() =>
          jsonResponse({ providers: [{ id: 'ollama1', kind: 'ollama', enabled: true }] }),
        ),
        getModels(() =>
          jsonResponse({
            status: 'ok',
            source: 'discovered',
            models: [{ id: 'qwen2.5-coder-7b' }],
          }),
        ),
        getMatrix(() =>
          matrixWire([
            {
              role: 'coding-agent',
              task_type: 'code',
              model: 'no-longer-served-model',
              fallback: [],
              updated_at: '2026-08-01T00:00:00Z',
              copilot_backed: false,
            },
          ]),
        ),
      ]),
    );
    render(<ModelMatrixPanel projectId="p1" />);
    await screen.findByText('ollama1');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await screen.findByText(/missing from/);
  });
});
