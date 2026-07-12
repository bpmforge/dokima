/** Device-auth first-run flow (D-007, API_DESIGN.md POST/GET /providers/copilot/device-auth). */
import { ProviderResponseShapeError } from './errors.js';
import { CopilotDeviceAuthError } from './copilot-errors.js';
import { GITHUB_BASE_URL } from './copilot-types.js';
import type {
  AccessTokenResponse,
  CopilotRuntime,
  DeviceCodeInfo,
  DeviceCodeResponse,
  DevicePollResult,
} from './copilot-types.js';

export async function requestDeviceCode(
  runtime: CopilotRuntime,
): Promise<DeviceCodeInfo> {
  const response = await runtime.fetchRaw(
    `${GITHUB_BASE_URL}/login/device/code`,
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: runtime.clientId, scope: 'read:user' }),
    },
    runtime.healthTimeoutMs,
  );
  if (!response.ok) await runtime.throwHttpError(response);
  const body = (await response.json()) as DeviceCodeResponse;
  if (
    !body.device_code ||
    !body.user_code ||
    !body.verification_uri ||
    body.expires_in === undefined ||
    body.interval === undefined
  ) {
    throw new ProviderResponseShapeError(
      runtime.id,
      'device-code response is missing required fields',
    );
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    expiresIn: body.expires_in,
    interval: body.interval,
  };
}

/**
 * One poll attempt against GitHub's token endpoint. Per API_DESIGN.md, the
 * `GET /providers/copilot/device-auth` route calls this once per request and
 * the cadence (waiting `intervalMs` between calls, honoring slow_down) is
 * owned by that caller — this function never sleeps. Persists the GitHub
 * token via the credential ref and resolves 'complete' on success.
 */
export async function pollDeviceAuthorization(
  runtime: CopilotRuntime,
  deviceCode: string,
  intervalMs: number,
): Promise<DevicePollResult> {
  const response = await runtime.fetchRaw(
    `${GITHUB_BASE_URL}/login/oauth/access_token`,
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: runtime.clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    },
    runtime.healthTimeoutMs,
  );
  // Per RFC 8628 §3.5 (via RFC 6749 §5.2), the continuable errors
  // (authorization_pending, slow_down) are token-endpoint errors, which
  // RFC 6749 defines as HTTP 400 — NOT 200. So the body must be parsed
  // before a non-2xx status can be treated as fatal; only fall back to
  // throwHttpError() when the body carries neither a token nor a
  // recognizable error (a genuine transport/server failure, or an
  // unparseable body).
  let body: AccessTokenResponse | undefined;
  try {
    body = (await response.clone().json()) as AccessTokenResponse;
  } catch {
    body = undefined;
  }

  if (body?.access_token) {
    await runtime.credentialStore.set(runtime.credentialRef, body.access_token);
    return { status: 'complete' };
  }
  if (body?.error) {
    switch (body.error) {
      case 'authorization_pending':
        return { status: 'pending', intervalMs };
      case 'slow_down':
        // "adds 5 seconds to the minimum polling interval" (GitHub device-flow docs).
        return { status: 'pending', intervalMs: intervalMs + 5_000 };
      default:
        throw new CopilotDeviceAuthError(body.error, body.error_description);
    }
  }
  if (!response.ok) await runtime.throwHttpError(response);
  throw new ProviderResponseShapeError(
    runtime.id,
    'access-token response has neither access_token nor error',
  );
}
