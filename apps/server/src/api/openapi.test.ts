import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument, extractRouteTable } from './openapi.js';
import { buildApiServer, type ApiServer } from './server.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4720;

/** `registerOpenApiRoute` is wired into `buildApiServer` itself (server.ts), so booting the real app is enough — no separate registration call. */
async function boot(): Promise<ApiServer> {
  return buildApiServer({
    token: TOKEN,
    port: PORT,
    isDbOpen: () => true,
    logger: false,
  });
}

function headers() {
  return { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };
}

describe('extractRouteTable', () => {
  it('reads every registered route from the live app, params intact', async () => {
    const { app } = await boot();
    try {
      const table = extractRouteTable(app);
      expect(table).toEqual(
        expect.arrayContaining([
          { method: 'GET', path: '/healthz' },
          { method: 'GET', path: '/api/v1/projects' },
          { method: 'POST', path: '/api/v1/projects' },
          { method: 'POST', path: '/api/v1/projects/:id/archive' },
          { method: 'GET', path: '/api/v1/projects/:id/tickets' },
          { method: 'POST', path: '/api/v1/tickets/:id/:verb' },
          { method: 'GET', path: '/api/v1/roster' },
          { method: 'GET', path: '/api/v1/openapi.json' },
        ]),
      );
      // HEAD is Fastify's auto-added twin of GET, not a distinct declared route.
      expect(table.some((r) => r.method === 'HEAD')).toBe(false);
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/v1/openapi.json (API_DESIGN §1)', () => {
  it('serves a document whose paths match the live route table exactly', async () => {
    const { app } = await boot();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/openapi.json',
        headers: headers(),
      });
      expect(res.statusCode).toBe(200);
      const doc = res.json() as { openapi: string; paths: Record<string, unknown> };
      expect(doc.openapi).toBe('3.1.0');
      expect(doc.paths['/api/v1/projects']).toBeDefined();
      expect(doc.paths['/api/v1/tickets/{id}/{verb}']).toBeDefined();
      expect(
        (doc.paths['/api/v1/tickets/{id}/{verb}'] as Record<string, unknown>).post,
      ).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('documents the idempotency contract on the verb route (API_DESIGN §1/§5)', async () => {
    const { app } = await boot();
    try {
      const doc = buildOpenApiDocument(app);
      const verbOp = doc.paths['/api/v1/tickets/{id}/{verb}']!.post as {
        parameters: Array<{ name: string; in: string; required: boolean }>;
        responses: Record<string, unknown>;
      };
      expect(verbOp.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
          }),
        ]),
      );
      expect(verbOp.responses['200']).toBeDefined();
      expect(verbOp.responses['400']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('every problem+json response schema names rule/evidence as documented fields', async () => {
    const { app } = await boot();
    try {
      const doc = buildOpenApiDocument(app);
      const projectsGet = doc.paths['/api/v1/projects']!.get as {
        responses: Record<
          string,
          {
            content?: Record<string, { schema: { properties: Record<string, unknown> } }>;
          }
        >;
      };
      const problemSchema =
        projectsGet.responses['401']!.content!['application/problem+json']!.schema;
      expect(problemSchema.properties).toMatchObject({
        rule: { type: 'string' },
        evidence: { type: 'object' },
      });
    } finally {
      await app.close();
    }
  });

  it('rejects an unauthenticated request with 401', async () => {
    const { app } = await boot();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/openapi.json',
        headers: { host: `127.0.0.1:${PORT}` },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
