/**
 * `GET /api/v1/openapi.json` (API_DESIGN §1: "OpenAPI generated from
 * Fastify + zod route schemas, served at `/api/v1/openapi.json` in dev").
 *
 * No route in this codebase attaches a Fastify `schema` (zod or otherwise)
 * today — `fastify-type-provider-zod` is not wired in anywhere, and `zod`
 * itself is not a dependency of `apps/server` (adding either means editing
 * `apps/server/package.json`, which is outside every W4 UI ticket's
 * write_scope, this one included). Rather than fabricate schemas that don't
 * describe real validation, this generator introspects the **live route
 * table** (`extractRouteTable`, parsing `app.printRoutes()` — the only
 * public route-introspection surface Fastify 5 exposes after routes are
 * already registered; an `onRoute` hook would only see routes registered
 * *after* the hook, so it can't replace a live, order-independent read of
 * the final table) so `paths` can never drift from what's actually being
 * served, and
 * layers real request/response shapes on top only for the routes this
 * ticket owns (the idempotent verb route). Every other path is listed with
 * an honest "unspecified" schema rather than an invented one (C-1).
 */

import type { FastifyInstance } from 'fastify';
import { PROBLEM_CONTENT_TYPE } from './problem.js';

export interface RouteTableEntry {
  method: string;
  path: string;
}

/**
 * Parses `app.printRoutes({ commonPrefix: false })`'s radix-tree text into
 * a flat `{method, path}` table. Each line is `<indent><branch><segment>
 * [(METHOD[, METHOD...])]`; `commonPrefix: false` guarantees every visible
 * segment already carries its own leading `/`, so parent+child string
 * concatenation (no separator inserted) reproduces the full path — verified
 * against this app's own real tree (nested params, multi-method nodes,
 * multi-level suffixes like `/estimate` + `/what-if`).
 */
export function extractRouteTable(app: FastifyInstance): RouteTableEntry[] {
  const lines = app.printRoutes({ commonPrefix: false }).split('\n');
  const stack: string[] = [];
  const entries: RouteTableEntry[] = [];
  const lineRe = /^((?:.{4})*)(?:├── |└── )(.*)$/;
  const methodsRe = /^(.*?)\s\(([A-Z, ]+)\)$/;

  for (const line of lines) {
    const lineMatch = lineRe.exec(line);
    if (!lineMatch) continue;
    const [, indent, contentRaw] = lineMatch;
    const depth = indent!.length / 4;
    const methodMatch = methodsRe.exec(contentRaw!);
    const segment = methodMatch ? methodMatch[1]! : contentRaw!;
    stack[depth] = segment;
    stack.length = depth + 1;
    if (!methodMatch) continue;
    const fullPath = stack.join('');
    const methods = methodMatch[2]!
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m !== 'HEAD'); // Fastify auto-adds HEAD for every GET — not a distinct route
    for (const method of methods) entries.push({ method, path: fullPath });
  }
  return entries;
}

/** `:param` (Fastify) → `{param}` (OpenAPI path template). */
function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_]+)/g, '{$1}');
}

function pathParams(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1]!);
}

const PROBLEM_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    instance: { type: 'string' },
    request_id: { type: 'string' },
    rule: { type: 'string' },
    evidence: { type: 'object' },
  },
  required: ['type', 'title', 'status', 'detail', 'instance', 'request_id'],
} as const;

const PROBLEM_RESPONSE = {
  description: 'RFC 7807 refusal (API_DESIGN §1/§4)',
  content: { [PROBLEM_CONTENT_TYPE]: { schema: PROBLEM_SCHEMA } },
};

/** The one route this ticket owns with a real, hand-verified request/response contract (API_DESIGN §1/§5, §2 "tickets — verbs"). */
const VERB_ROUTE_PATH = '/api/v1/tickets/{id}/{verb}';
const VERB_ROUTE_OPERATION = {
  summary: 'Fire a ticket lifecycle verb (claim/start/close/accept/release/comment)',
  parameters: [
    {
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      schema: { type: 'string' },
      description:
        'Client-generated UUID; replay of a seen key returns the original response (API_DESIGN §1/§5).',
    },
    {
      name: 'project',
      in: 'query',
      required: true,
      schema: { type: 'string' },
    },
  ],
  responses: {
    '200': {
      description: 'Verb applied (or replayed from a prior identical Idempotency-Key)',
      headers: {
        'X-Event-Seq': {
          schema: { type: 'integer' },
          description: 'The resulting event log sequence number (API_DESIGN §1/§5)',
        },
      },
    },
    '400': PROBLEM_RESPONSE,
    '401': PROBLEM_RESPONSE,
    '403': PROBLEM_RESPONSE,
    '404': PROBLEM_RESPONSE,
    '409': PROBLEM_RESPONSE,
  },
};

function genericOperation(method: string, path: string) {
  const params = pathParams(path).map((name) => ({
    name,
    in: 'path' as const,
    required: true,
    schema: { type: 'string' },
  }));
  return {
    summary: `${method} ${path}`,
    ...(params.length > 0 ? { parameters: params } : {}),
    responses: {
      '200': {
        description: 'OK — schema not yet generated for this route (see module header)',
      },
      '401': PROBLEM_RESPONSE,
      '403': PROBLEM_RESPONSE,
      ...(method === 'POST' ? { '400': PROBLEM_RESPONSE } : {}),
    },
  };
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
}

/** Builds the OpenAPI document from `app`'s live route table (never hand-copied — see module header). */
export function buildOpenApiDocument(app: FastifyInstance): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const { method, path } of extractRouteTable(app)) {
    const openApiPath = toOpenApiPath(path);
    paths[openApiPath] ??= {};
    paths[openApiPath]![method.toLowerCase()] =
      openApiPath === VERB_ROUTE_PATH && method === 'POST'
        ? VERB_ROUTE_OPERATION
        : genericOperation(method, path);
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Shipwright API', version: 'v1' },
    paths,
  };
}

/** `GET /api/v1/openapi.json` — dev-only per API_DESIGN §1; caller decides whether to gate registration on `NODE_ENV`. */
export function registerOpenApiRoute(app: FastifyInstance): void {
  app.get('/api/v1/openapi.json', async (_request, reply) => {
    return reply.send(buildOpenApiDocument(app));
  });
}
