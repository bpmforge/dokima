/**
 * The Copilot device flow, given an HTTP surface (W12-26).
 *
 * `requestDeviceCode`/`pollDeviceAuthorization` have been complete and tested
 * since the adapter landed and had NO caller — `copilot-device-auth.ts` even
 * names `GET /providers/copilot/device-auth` in its own doc comment and says
 * the poll cadence belongs to the caller, because it never sleeps. The
 * adapter, the panel affordance (W12-21) and the docs all existed; the HTTP
 * middle did not.
 *
 * POLLED FROM THE SERVER, not proxied from the browser: the exchanged token
 * lands in the keychain via the credential store (Law 8) and must never
 * transit the web client.
 *
 * ITS OWN FILE because folding it into `providers-routes.ts` took that file
 * from 394 to 499 lines, past the 400-line CODE_BOOK_PROTOCOL cap. The device
 * flow is a self-contained protocol against a single external endpoint, so
 * splitting on that seam is the shape the cap was asking for.
 *
 * D-019 IS NOT WEAKENED HERE. These routes obtain a credential; they never
 * create or enable a provider entry. Enabling `copilot` still goes through the
 * registry's consent gate (`validate.ts`, `consent-required`), which is a
 * different file this one does not touch — holding a token is not consent to
 * use it.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  COPILOT_OAUTH_CLIENT_ID,
  CopilotDeviceAuthError,
  createHttpFns,
  DEFAULT_COPILOT_CREDENTIAL_REF,
  pollDeviceAuthorization,
  requestDeviceCode,
  type CopilotRuntime,
} from '@dokima/gateway';
import { resolveCredentialStore } from '@dokima/shared';
import { PROBLEM_CONTENT_TYPE, problem } from '../problem.js';
import { badRequest } from './settings-route-helpers.js';

const DEFAULT_INTERVAL_MS = 5_000;

function copilotRuntime(): CopilotRuntime {
  const { fetchRaw, throwHttpError } = createHttpFns('copilot', fetch);
  return {
    id: 'copilot',
    credentialStore: resolveCredentialStore(process.env),
    credentialRef: DEFAULT_COPILOT_CREDENTIAL_REF,
    clientId: COPILOT_OAUTH_CLIENT_ID,
    healthTimeoutMs: 30_000,
    now: () => Date.now(),
    // Each request builds a fresh runtime, so there is no cached token to
    // carry — the exchanged credential is persisted to the keychain by
    // `pollDeviceAuthorization` itself, which is the durable half.
    cachedToken: undefined,
    fetchRaw,
    throwHttpError,
  };
}

/**
 * A device flow ends in more than one way and a caller has to tell them apart:
 * an expired code means "start again", a denial means "the user said no", and
 * a transport failure means "retry the same code". Collapsing all three into
 * one 502 is what makes a sign-in UI spin forever on a flow that is already
 * over, so `CopilotDeviceAuthError.code` is surfaced by name.
 */
function deviceAuthFailure(request: FastifyRequest, reply: FastifyReply, err: unknown) {
  if (err instanceof CopilotDeviceAuthError) {
    return reply
      .code(400)
      .type(PROBLEM_CONTENT_TYPE)
      .send(
        problem({
          type: `https://dokima.dev/errors/device-auth/${err.code}`,
          title: 'GitHub ended the sign-in',
          status: 400,
          // The code IS the outcome — `expired_token`, `access_denied`,
          // `incorrect_device_code` — and it is what the caller branches on.
          detail: err.message,
          instance: request.url,
          requestId: request.id.toString(),
          evidence: { code: err.code },
        }),
      );
  }
  return reply
    .code(502)
    .type(PROBLEM_CONTENT_TYPE)
    .send(
      problem({
        type: 'https://dokima.dev/errors/device-auth',
        title: 'Could not reach GitHub to sign in',
        status: 502,
        detail: err instanceof Error ? err.message : String(err),
        instance: request.url,
        requestId: request.id.toString(),
      }),
    );
}

export function registerCopilotDeviceAuthRoutes(app: FastifyInstance): void {
  app.post(
    '/api/v1/providers/copilot/device-auth',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const info = await requestDeviceCode(copilotRuntime());
        return reply.send({
          user_code: info.userCode,
          verification_uri: info.verificationUri,
          device_code: info.deviceCode,
          // GitHub speaks seconds; every caller here counts milliseconds.
          interval_ms: info.interval * 1000,
          expires_in_ms: info.expiresIn * 1000,
        });
      } catch (err) {
        return deviceAuthFailure(request, reply, err);
      }
    },
  );

  app.get(
    '/api/v1/providers/copilot/device-auth',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as { device_code?: string; interval_ms?: string };
      if (!q.device_code) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'device_code is required'));
      }
      const requested = Number(q.interval_ms);
      try {
        const result = await pollDeviceAuthorization(
          copilotRuntime(),
          q.device_code,
          Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_INTERVAL_MS,
        );
        // `intervalMs` exists only on the pending arm — GitHub returns a longer
        // interval when it asks you to slow down, and there is nothing left to
        // wait for once the flow completes.
        return reply.send(
          result.status === 'pending'
            ? { status: result.status, interval_ms: result.intervalMs }
            : { status: result.status },
        );
      } catch (err) {
        return deviceAuthFailure(request, reply, err);
      }
    },
  );
}
