/** Shared HTTP plumbing for the settings REST client — mirrors apps/web/src/fleet/api.ts's conventions. */

export function readInjectedToken(): string | undefined {
  return (globalThis as { __SHIPWRIGHT_TOKEN__?: string }).__SHIPWRIGHT_TOKEN__;
}

export class SettingsApiError extends Error {
  constructor(
    public readonly status: number,
    detail?: string,
  ) {
    super(detail ?? `Settings API request failed with status ${status}`);
    this.name = 'SettingsApiError';
  }
}

export interface SettingsApiOptions {
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined;
  baseUrl?: string;
}

export async function request(
  urlPath: string,
  init: RequestInit,
  opts: SettingsApiOptions,
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const getToken = opts.getToken ?? readInjectedToken;
  const token = getToken();
  const res = await fetchImpl(`${opts.baseUrl ?? ''}${urlPath}`, {
    ...init,
    headers: {
      ...init.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => undefined);
    const detail =
      typeof body === 'object' && body !== null && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : undefined;
    throw new SettingsApiError(res.status, detail);
  }
  if (res.status === 204) return undefined;
  return res.json();
}

export function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  };
}
