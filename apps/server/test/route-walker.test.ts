import type { InjectOptions } from 'fastify';
import { describe, expect, it } from 'vitest';
import { extractRouteTable } from '../src/api/openapi.js';
import { buildApiServer } from '../src/api/server.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4730;

/** Any string works for a path param in these checks — the auth hook (and,
 * for the idempotency check, the header check) runs before route-specific
 * param validation. `:verb` gets a real verb so the request reaches the
 * Idempotency-Key check instead of failing earlier on "unknown verb". */
function substituteParams(path: string): string {
  return path.replace(/:([A-Za-z_]+)/g, (_match, name) =>
    name === 'verb' ? 'claim' : 'x',
  );
}

/**
 * Route-walker (API_DESIGN §5, TESTING.md §5): reads the app's real,
 * currently-registered route table (`extractRouteTable`, the same
 * introspection `openapi.ts` uses) so a new route is covered automatically
 * without editing this file — no hand-maintained route list to fall out of
 * sync.
 */
describe('route-walker (API_DESIGN §5, TESTING.md §5)', () => {
  it('every route: no token -> 401 (except /healthz), bad Origin -> 403; verb routes w/o Idempotency-Key -> 400', async () => {
    const { app } = await buildApiServer({
      token: TOKEN,
      port: PORT,
      isDbOpen: () => true,
      logger: false,
    });
    try {
      const routes = extractRouteTable(app);
      expect(routes.length).toBeGreaterThan(0); // sanity: the table actually has entries

      for (const { method: rawMethod, path } of routes) {
        const method = rawMethod as NonNullable<InjectOptions['method']>;
        const url = substituteParams(path);

        const noTokenRes = await app.inject({
          method,
          url,
          headers: { host: `127.0.0.1:${PORT}` },
        });
        // /healthz is the one documented exception (auth-plugin.ts: "required
        // on every /api/** path except /healthz") — every other route requires it.
        if (path === '/healthz') {
          expect(noTokenRes.statusCode, `${method} ${path} (no token)`).not.toBe(401);
        } else {
          expect(noTokenRes.statusCode, `${method} ${path} (no token)`).toBe(401);
        }

        const badOriginRes = await app.inject({
          method,
          url,
          headers: {
            host: `127.0.0.1:${PORT}`,
            authorization: `Bearer ${TOKEN}`,
            origin: 'http://evil.example',
          },
        });
        // SC-08's Host/Origin allowlist applies to every path, /healthz included.
        expect(badOriginRes.statusCode, `${method} ${path} (bad Origin)`).toBe(403);

        // API_DESIGN §1: only *verb* endpoints (path carries a `:verb` param)
        // REQUIRE Idempotency-Key — other mutating POSTs merely accept it.
        if (method === 'POST' && path.includes(':verb')) {
          const noIdemRes = await app.inject({
            method,
            url,
            headers: { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` },
            payload: {},
          });
          expect(noIdemRes.statusCode, `${method} ${path} (no Idempotency-Key)`).toBe(
            400,
          );
        }
      }
    } finally {
      await app.close();
    }
  });
});
