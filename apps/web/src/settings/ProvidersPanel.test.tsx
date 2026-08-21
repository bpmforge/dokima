// @vitest-environment jsdom
/**
 * DOM coverage for ProvidersPanel AND for ModelMatrixPanel's model-picker
 * behavior (AC1 "select from a LIST", AC2 states table): ModelMatrixPanel.tsx
 * has no test-sibling in this ticket's write_scope, and it composes
 * ProvidersPanel directly (UX_SPEC §6a's "[ Providers ]" then "[ Models ]"
 * stacked in one Settings panel), so its behavior is exercised here instead,
 * under its own `describe` block, rather than left untested.
 *
 * Every component here calls the real providers-api.ts / api.ts client
 * functions against a stubbed `global.fetch` (never the real network, Law
 * 9) — same technique as board/drawer/EvidencePanel.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProvidersPanel } from './ProvidersPanel.js';
import { ModelMatrixPanel } from './ModelMatrixPanel.js';
import { useState } from 'react';
import type { ProviderCatalog, ProviderEntry } from './providers-api.js';

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


/**
 * W12-35: mirrors how `SettingsPage` now owns the catalog — one
 * `ProvidersPanel`, its discoveries handed to `ModelMatrixPanel` as props.
 * These tests verify the integration (register/test a provider, the matrix
 * picker populates), and that integration is exactly what the lift had to
 * preserve; rendering `ModelMatrixPanel` alone no longer expresses it because
 * the panel no longer mounts its own providers list.
 */
function MatrixWithProviders({ projectId = 'p1' }: { projectId?: string }) {
  const [catalogs, setCatalogs] = useState<Record<string, ProviderCatalog>>({});
  const [entries, setEntries] = useState<ProviderEntry[]>([]);
  return (
    <>
      <ProvidersPanel
        projectId={projectId}
        onCatalogsChange={setCatalogs}
        onEntriesChange={setEntries}
      />
      <ModelMatrixPanel
        projectId={projectId}
        catalogs={catalogs}
        providerEntries={entries}
      />
    </>
  );
}

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
              // W12-15: the sample reason was the pre-W12-11 "not yet
              // constructible" copy, which stopped being a thing the server
              // can say once cloud kinds became constructible. This test is
              // about the panel rendering WHATEVER reason the server sends,
              // so it keeps working — but a stale sample reads as current
              // product copy to anyone skimming, which is how the duplicate
              // survived in the first place.
              'provider kind "openai" needs a credential: register one (its ref is stored, never the secret) or set DOKIMA_MODEL_API_KEY. Refusing rather than calling a paid API unauthenticated.',
          }),
        ),
      ]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText('oa1');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await screen.findByText(/needs a credential/);
  });

  it('"Provider disabled": the row stays visible, greyed, alongside an enabled one', async () => {
    const DISABLED_ENTRY = { id: 'off1', kind: 'ollama', enabled: false };
    const ENABLED_ENTRY = { id: 'on1', kind: 'ollama', enabled: true };
    fetchSpy.mockImplementation(
      router([
        getProviders(() => jsonResponse({ providers: [DISABLED_ENTRY, ENABLED_ENTRY] })),
      ]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText('off1');
    await screen.findByText('on1');
    const disabledRow = screen.getByText('off1').closest('tr')!;
    expect((disabledRow as HTMLElement).style.opacity).toBe('0.6');
    const enabledCheckbox = screen.getByLabelText('Enable off1') as HTMLInputElement;
    expect(enabledCheckbox.checked).toBe(false);
  });
});

describe('ProvidersPanel remove (UX_SPEC §6a exact removal copy, C-6)', () => {
  const ENTRY = {
    id: 'gone',
    kind: 'ollama',
    enabled: true,
    credential_ref: 'gone-credential',
  };

  it('names the id and the keychain ref between the two clicks, and only calls DELETE on the second (W18-01)', async () => {
    fetchSpy.mockImplementation(
      router([
        getProviders(() => jsonResponse({ providers: [ENTRY] })),
        deleteProviderRoute(() => ({ ok: true, status: 204 }) as Response),
      ]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText('gone');
    const button = screen.getByTestId('provider-remove-gone');
    fireEvent.click(button);

    // Armed, not executed: the exact §6a removal copy stands between the clicks.
    const detail = screen.getByRole('status').textContent ?? '';
    expect(detail).toContain('Remove gone?');
    expect(detail).toContain('gone-credential');
    expect(detail).toContain('append-only (C-6)');
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('/providers/gone'),
      expect.objectContaining({ method: 'DELETE' }),
    );

    fireEvent.click(button);
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/providers/gone'),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('does nothing when the armed state lapses unclicked', async () => {
    fetchSpy.mockImplementation(
      router([getProviders(() => jsonResponse({ providers: [ENTRY] }))]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText('gone');
    fireEvent.click(screen.getByTestId('provider-remove-gone'));

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

  it('the Model field is a real <select> populated from the discovered/bundled catalog, disabled until one exists (AC1: pick from a LIST, not free text)', async () => {
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
    render(<MatrixWithProviders />);

    const modelSelect = (await screen.findByLabelText('Model')) as HTMLSelectElement;
    expect(modelSelect.tagName).toBe('SELECT');
    expect(modelSelect.disabled).toBe(true);

    await screen.findByText('ollama1');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await vi.waitFor(() => {
      expect(modelSelect.disabled).toBe(false);
    });
    expect(modelSelect.querySelector('option[value="qwen2.5-coder-7b"]')).not.toBeNull();

    fireEvent.change(modelSelect, { target: { value: 'qwen2.5-coder-7b' } });
    expect(modelSelect.value).toBe('qwen2.5-coder-7b');
  });

  it('excludes a disabled provider\'s models from the select (UX_SPEC §6a "Provider disabled": a refusal to use)', async () => {
    fetchSpy.mockImplementation(
      router([
        getProviders(() =>
          jsonResponse({
            providers: [{ id: 'off1', kind: 'ollama', enabled: false }],
          }),
        ),
        getModels(() =>
          jsonResponse({
            status: 'ok',
            source: 'discovered',
            models: [{ id: 'unreachable-via-disabled' }],
          }),
        ),
        getMatrix(() => matrixWire([])),
      ]),
    );
    render(<MatrixWithProviders />);
    await screen.findByText('off1');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    const modelSelect = (await screen.findByLabelText('Model')) as HTMLSelectElement;
    // Test resolved (models fetched), but the disabled provider's models
    // never populate the picker — the select stays disabled/empty.
    const providerRow = (await screen.findByText('off1')).closest('tr')!;
    await vi.waitFor(() => {
      expect(providerRow.textContent).toContain('1'); // models count column shows the fetched count
    });
    expect(modelSelect.disabled).toBe(true);
    expect(
      modelSelect.querySelector('option[value="unreachable-via-disabled"]'),
    ).toBeNull();
  });

  it('explains a maker!=verifier refusal inline, verbatim, for a brand-new row with no existing table row yet (AC2)', async () => {
    fetchSpy.mockImplementation(
      router([
        getProviders(() =>
          jsonResponse({ providers: [{ id: 'ollama1', kind: 'ollama', enabled: true }] }),
        ),
        getModels(() =>
          jsonResponse({
            status: 'ok',
            source: 'discovered',
            models: [{ id: 'local/qwen' }],
          }),
        ),
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
    render(<MatrixWithProviders />);
    await screen.findByText('ollama1');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    const modelSelect = (await screen.findByLabelText('Model')) as HTMLSelectElement;
    await vi.waitFor(() => expect(modelSelect.disabled).toBe(false));

    const form = screen.getByRole('form', { name: 'Add matrix row' });
    fireEvent.change(form.querySelector('input[placeholder="coding-agent"]')!, {
      target: { value: 'challenger' },
    });
    fireEvent.change(modelSelect, { target: { value: 'local/qwen' } });
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
    render(<MatrixWithProviders />);
    await screen.findByText('ollama1');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await screen.findByText(/missing from any registered provider/);
  });

  it('marks a row "unroutable" (not "missing") when its model is served only by a now-disabled provider, even with a second enabled provider registered', async () => {
    // A second, enabled provider (with an unrelated model) is deliberately
    // included so `catalogOptions` (enabled-only) is genuinely non-empty
    // and does NOT contain 'still-technically-served'. With only the
    // disabled provider registered, `catalogOptions.length === 0` would
    // trip the "no catalogs fetched yet" guard and force `isKnown = true`
    // regardless of the unroutable/missing JSX precedence — masking a
    // regression where that precedence gets reordered. This fixture rules
    // that out: the missing-badge condition is only false because
    // `isUnroutable` legitimately took precedence.
    fetchSpy.mockImplementation(
      router([
        getProviders(() =>
          jsonResponse({
            providers: [
              { id: 'off1', kind: 'ollama', enabled: false },
              { id: 'on1', kind: 'ollama', enabled: true },
            ],
          }),
        ),
        getModels((providerId) =>
          jsonResponse({
            status: 'ok',
            source: 'discovered',
            models:
              providerId === 'off1'
                ? [{ id: 'still-technically-served' }]
                : [{ id: 'unrelated-model' }],
          }),
        ),
        getMatrix(() =>
          matrixWire([
            {
              role: 'coding-agent',
              task_type: 'code',
              model: 'still-technically-served',
              fallback: [],
              updated_at: '2026-08-01T00:00:00Z',
              copilot_backed: false,
            },
          ]),
        ),
      ]),
    );
    render(<MatrixWithProviders />);
    await screen.findByText('off1');
    await screen.findByText('on1');
    for (const button of screen.getAllByRole('button', { name: 'Test' })) {
      fireEvent.click(button);
    }

    await screen.findByText(/unroutable — provider off1 is disabled/);
    expect(screen.queryByText(/missing from/)).toBeNull();
  });

  it('renders the Copilot-backed flag on an existing row regardless of how it was created (server-driven copilot_backed flag, unaffected by the picker)', async () => {
    fetchSpy.mockImplementation(
      router([
        getProviders(() => jsonResponse({ providers: [] })),
        getMatrix(() =>
          matrixWire(
            [
              {
                role: 'challenger',
                task_type: 'code',
                model: 'copilot/gpt-4',
                fallback: [],
                updated_at: '2026-08-01T00:00:00Z',
                copilot_backed: true,
              },
            ],
            true,
          ),
        ),
      ]),
    );
    render(<MatrixWithProviders />);
    const copilotRow = await screen.findByRole('row', { name: /challenger/ });
    expect(copilotRow.textContent).toContain('Copilot-backed');
  });
});

describe('auth method rendering (W12-21)', () => {
  async function openForm() {
    fetchSpy.mockImplementation(
      router([getProviders(() => jsonResponse({ providers: [] }))]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText(/No providers yet/);
    return screen.getByLabelText('Kind');
  }

  it(
    'RED FIXTURE: a local kind is NOT asked for an API key. The panel used to show ' +
      'one always-on key box regardless of kind, which is how "no credentials ' +
      'needed" and "sign in to a subscription" both had nowhere to appear',
    async () => {
      await openForm();
      expect(screen.queryByLabelText(/API key/)).toBeNull();
      expect(screen.getByText(/No credentials needed/)).toBeTruthy();
    },
  );

  it('choosing a cloud kind shows the API key field, and only then', async () => {
    const kind = await openForm();
    fireEvent.change(kind, { target: { value: 'openai' } });
    expect(screen.getByLabelText(/API key/)).toBeTruthy();
    expect(screen.queryByText(/No credentials needed/)).toBeNull();
  });

  it(
    'a subscription-only kind shows a sign-in affordance and NO key box — Copilot ' +
      'takes a credential store, not a key',
    async () => {
      const kind = await openForm();
      fireEvent.change(kind, { target: { value: 'copilot' } });
      expect(screen.queryByLabelText(/API key/)).toBeNull();
      expect(screen.getByTestId('auth-subscription-pending')).toBeTruthy();
    },
  );

  it(
    'vertex shows the ADC path rather than an API key — the shape that proved auth ' +
      'could not be modelled as api-key-vs-oauth (D-007)',
    async () => {
      const kind = await openForm();
      fireEvent.change(kind, { target: { value: 'vertex' } });
      expect(screen.queryByLabelText(/API key/)).toBeNull();
      expect(screen.getByTestId('auth-gcp-adc')).toBeTruthy();
    },
  );

  it('an endpoint kind supporting both methods offers the choice', async () => {
    const kind = await openForm();
    fireEvent.change(kind, { target: { value: 'oai-compat' } });
    fireEvent.change(screen.getByLabelText('Authentication'), {
      target: { value: 'api-key' },
    });
    expect(screen.getByLabelText(/API key/)).toBeTruthy();
  });
});

describe('Vertex project scope (W12-25)', () => {
  async function openForm() {
    fetchSpy.mockImplementation(
      router([getProviders(() => jsonResponse({ providers: [] }))]),
    );
    render(<ProvidersPanel projectId="p1" />);
    await screen.findByText(/No providers yet/);
    return screen.getByLabelText('Kind');
  }

  it(
    'RED FIXTURE: choosing Vertex asks for the GCP project and region. Without ' +
      'them the registry refuses the entry (W12-14), so a panel that never asked ' +
      'meant Vertex was configurable only by hand-editing settings',
    async () => {
      const kind = await openForm();
      fireEvent.change(kind, { target: { value: 'vertex' } });
      expect(screen.getByLabelText('GCP project')).toBeTruthy();
      expect(screen.getByLabelText('Region')).toBeTruthy();
    },
  );

  it('offers the service-account JSON as an OPTIONAL credential, and says it wins over ambient ADC', async () => {
    const kind = await openForm();
    fireEvent.change(kind, { target: { value: 'vertex' } });
    expect(screen.getByLabelText(/Service-account JSON/)).toBeTruthy();
    expect(screen.getByText(/takes precedence over ambient credentials/)).toBeTruthy();
  });

  it('names the gcloud command rather than leaving ambient credentials a mystery', async () => {
    const kind = await openForm();
    fireEvent.change(kind, { target: { value: 'vertex' } });
    expect(screen.getByText(/gcloud auth application-default login/)).toBeTruthy();
  });

  it('does NOT ask a non-project kind for a project — the fields are per-kind, not global', async () => {
    const kind = await openForm();
    fireEvent.change(kind, { target: { value: 'openai' } });
    expect(screen.queryByLabelText('GCP project')).toBeNull();
    expect(screen.queryByLabelText('Region')).toBeNull();
  });
});
