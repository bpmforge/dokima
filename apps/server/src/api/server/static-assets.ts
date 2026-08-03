/**
 * server/static-assets.ts — static asset serving for the built Canvas, including token injection.
 *
 * Chapter of the 408-line api/server.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 * Lives here rather than in a new directory: a sibling server/ already
 * existed, and bootstrap/ would collide with apps/server/src/bootstrap/.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
}

/** Resolves a request path under `root`, refusing any `..` traversal outside it. */
function resolveStaticPath(root: string, urlPath: string): string | undefined {
  const pathname = new URL(urlPath, 'http://localhost').pathname;
  const resolved = path.resolve(root, `.${pathname}`);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return undefined;
  return resolved;
}

/**
 * API_DESIGN §1: the bearer token is "auto-injected by the served SPA" —
 * the browser has no other way to read `~/.dokima/token` (SC-08 static
 * assets are intentionally unauthenticated so the shell can load before it
 * has a token at all). Injected as a global rather than fetched over an
 * unauthenticated endpoint, which would hand the token to any localhost
 * page, not just this one.
 */
function injectToken(html: string, token: string): string {
  const script = `<script>window.__DOKIMA_TOKEN__=${JSON.stringify(token)};</script>`;
  return html.includes('</head>')
    ? html.replace('</head>', `${script}</head>`)
    : script + html;
}

export function registerStatic(
  app: FastifyInstance,
  webDistDir: string | undefined,
  token: string,
): void {
  if (!webDistDir) return;

  app.get('/*', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const target = resolveStaticPath(webDistDir, request.url);
    if (target) {
      try {
        const body = await fs.readFile(target);
        if (target.endsWith('.html')) {
          return reply
            .type('text/html; charset=utf-8')
            .send(injectToken(body.toString('utf8'), token));
        }
        return reply.type(contentTypeFor(target)).send(body);
      } catch {
        // Not a real file (or a directory, e.g. `/`) — fall through to the SPA shell.
      }
    }
    const index = await fs.readFile(path.join(webDistDir, 'index.html'), 'utf8');
    return reply.type('text/html; charset=utf-8').send(injectToken(index, token));
  });

  app.setNotFoundHandler(async (_request, reply) => {
    await reply.code(404).send({ error: 'not_found' });
  });
}

/** SC-08: the server binds 127.0.0.1 only, never 0.0.0.0 — single choke point. */
