/**
 * Ambient type for Node's built-in global `WebSocket` client (undici-backed,
 * stable since Node 22 — no flag required, verified on this repo's pinned
 * Node 22.x). `apps/server`'s tsconfig only pulls in the `ES2023` lib (no
 * `dom`), and `apps/server/tsconfig.json` is outside this ticket's
 * write_scope, so this declares just the surface the test suite here uses
 * rather than widening the project-wide lib config.
 */
export {};

declare global {
  class WebSocket {
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;

    constructor(url: string, options?: { headers?: Record<string, string> });

    readonly readyState: number;
    onopen: (() => void) | null;
    onmessage: ((event: { data: unknown }) => void) | null;
    onerror: ((event: { message?: string }) => void) | null;
    onclose: ((event: { code: number; reason: string }) => void) | null;

    send(data: string): void;
    close(code?: number, reason?: string): void;
  }
}
