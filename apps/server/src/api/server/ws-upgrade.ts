/**
 * server/ws-upgrade.ts — WebSocket upgrade dispatch.
 *
 * Chapter of the 408-line api/server.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 * Lives here rather than in a new directory: a sibling server/ already
 * existed, and bootstrap/ would collide with apps/server/src/bootstrap/.
 */

import { IncomingMessage } from 'node:http';
import { Duplex } from 'node:stream';

import { checkAuth, type AuthPluginOptions } from '../auth-plugin.js';
import { WsHub } from '../ws-hub.js';
import { completeHandshake, rejectUpgrade } from '../ws-socket.js';

/** The upgrade path this dispatcher answers on. Kept beside the dispatcher
 * rather than imported from the composition root, so the chapter is
 * self-contained and server.ts does not have to export a constant purely for
 * its own chapter to read back. */
export const WS_PATH = '/api/v1/ws';

export function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  authOpts: AuthPluginOptions,
  wsHub: WsHub,
): void {
  const url = req.url ?? '/';
  const pathname = new URL(url, 'http://localhost').pathname;
  if (pathname !== WS_PATH) {
    socket.destroy();
    return;
  }

  const result = checkAuth(
    {
      host: req.headers.host,
      origin: req.headers.origin,
      url,
      authorization: req.headers.authorization,
    },
    authOpts,
  );
  if (!result.ok) {
    rejectUpgrade(
      socket,
      result.status,
      result.status === 401 ? 'Unauthorized' : 'Forbidden',
      {
        error: result.reason,
        rule: result.rule,
      },
    );
    return;
  }

  const ws = completeHandshake(req, socket);
  if (ws) wsHub.handleConnection(ws);
}
