/** Shared fake-fetch harness for the Gitea adapter's recorded-fixture contract tests. */

export interface FakeCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeResponseSpec {
  status: number;
  statusText?: string;
  body: unknown;
  headers?: Record<string, string>;
}

export function fakeFetch(handler: (call: FakeCall) => FakeResponseSpec): {
  fetchImpl: typeof fetch;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const call: FakeCall = {
      method: init?.method ?? 'GET',
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const result = handler(call);
    return new Response(result.body === undefined ? '' : JSON.stringify(result.body), {
      status: result.status,
      statusText: result.statusText,
      headers: { 'content-type': 'application/json', ...result.headers },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}
