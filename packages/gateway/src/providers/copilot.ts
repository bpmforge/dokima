/**
 * GitHub Copilot adapter (FR-G1, W2-03, D-007): the device-auth first-run
 * flow corporate opencode users already know, plus the OpenAI-compatible
 * chat-completions wire format GitHub proxies Copilot models through.
 *
 * Book-style split (file-size gate, 400-line cap): once copilot.ts exceeded
 * the cap it was split into flat sibling chapters, matching how the other
 * providers here (anthropic.ts, openai.ts, oai-compat.ts) are single flat
 * files — copilot-types.ts (wire shapes, config, constants, the
 * CopilotRuntime context), copilot-errors.ts (Copilot-specific error
 * classes), copilot-http.ts (fetch/timeout plumbing + generic status→error
 * mapping), copilot-device-auth.ts (the device flow), copilot-token.ts
 * (Copilot-internal token exchange/refresh + the authenticated request
 * wrapper), copilot-chat.ts (chat/models wire parsing). Flat siblings (not a
 * copilot/ subdirectory) keep every chapter inside the ticket's original
 * `copilot*` write_scope. This file is the barrel: the CopilotProvider class
 * wires the chapters together and is the only place that owns per-instance
 * state (the RequestQueue, the mutable token cache).
 *
 * The device flow itself (POST /login/device/code, POST
 * /login/oauth/access_token, grant_type=urn:ietf:params:oauth:grant-type:device_code,
 * error codes authorization_pending/slow_down/expired_token/access_denied,
 * "slow_down adds 5s to the interval") is officially documented at
 * docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 * (verified 2026-07-12 via WebFetch). The Authorization scheme for
 * api.github.com is "Bearer" per
 * docs.github.com/en/rest/authentication/authenticating-to-the-rest-api
 * (also verified 2026-07-12; "token" is accepted too but Bearer is current).
 *
 * The Copilot-internal surface (GET /copilot_internal/v2/token to exchange
 * the GitHub OAuth token for a short-lived Copilot bearer + dynamic API
 * base URL, and the editor-identification headers the chat-completions
 * endpoint expects) is NOT officially documented by GitHub. Verified
 * 2026-07-12 by cross-referencing three independent open-source Copilot
 * client implementations that agree on the endpoint, response shape
 * ({token, expires_at, endpoints: {api}}), and required headers
 * (Authorization, Editor-Version, Editor-Plugin-Version,
 * Copilot-Integration-Id, User-Agent): charmbracelet/catwalk
 * (cmd/copilot/main.go), Nano-Collective/nanocoder
 * (source/auth/github-copilot.ts), and QuixiAI/Hexis
 * (core/auth/github_copilot.py). The OAuth app client id
 * ('Iv1.b507a08c87ecfe98') is likewise cross-confirmed by two of those
 * (Hexis, nanocoder) — it is GitHub's own VS Code Copilot Chat app id,
 * public and shared by every OSS Copilot-compatible client, not a secret.
 *
 * Chat/models responses reuse the same minimal JSON shape oai-compat.ts
 * already parses for /chat/completions + /models. This file duplicates
 * that parsing instead of importing oai-compat.ts because the Copilot
 * bearer must be refreshed transparently between calls (~30min expiry,
 * TECH_STACK.md) — oai-compat.ts bakes its Authorization header in once at
 * construction, which cannot express a token that changes mid-lifetime.
 * Contract tests pin every wire shape via recorded fixtures
 * (copilot-fixtures.ts), never a live call (docs/TESTING.md).
 *
 * Credential handling (FR-S2, D-012): only the long-lived GitHub OAuth
 * token is persisted, via an injected CredentialStore-shaped ref (never a
 * plaintext fallback). packages/gateway/package.json is outside this
 * ticket's write_scope, so this file cannot depend on packages/shared's
 * real CredentialStore (same constraint noted in anthropic.ts's and
 * openai.ts's file headers) — CopilotCredentialStore (types.ts) is
 * structurally identical, so packages/shared's implementations satisfy it
 * unmodified. The default ref name 'dokima:copilot:github-token'
 * matches the convention already exercised by packages/shared's own tests
 * (credential-store.test.ts, settings-files.test.ts). The short-lived
 * Copilot API bearer is cache-only (in memory), never persisted — it's
 * cheap to re-derive and carries no value once expired.
 *
 * Subscription-lacks-access handling: two independent real-world signals,
 * both mapped onto CopilotSubscriptionError with remediation text — (a)
 * any Copilot-internal endpoint returns 403, or (b) the token endpoint
 * returns 200 without a `token` field (documented behavior per
 * Nano-Collective/nanocoder, for accounts that authenticate fine but were
 * never granted the Copilot Chat/API scope).
 *
 * Cost table is optional, unlike Anthropic/OpenAI (usage.ts's required
 * `costTable`): Copilot is sold as a flat-fee subscription with no public
 * per-token price, so LOCAL_COST_TABLE's honest $0-but-metered default
 * (same reasoning as local models) applies unless a caller supplies real
 * pricing for their own accounting needs.
 */
import {
  ProviderHttpError,
  ProviderTimeoutError,
  ProviderUnreachableError,
} from './errors.js';
import { RequestQueue } from './request-queue.js';
import type {
  ChatRequest,
  ChatResponse,
  ModelInfo,
  Provider,
  ProviderHealth,
  ProviderQueueStats,
} from './types.js';
import { LOCAL_COST_TABLE, type CostTable } from './usage.js';
import {
  buildChatRequestBody,
  parseChatCompletion,
  parseModelsList,
} from './copilot-chat.js';
import { pollDeviceAuthorization, requestDeviceCode } from './copilot-device-auth.js';
import { CopilotSubscriptionError } from './copilot-errors.js';
import { createHttpFns } from './copilot-http.js';
import { ensureCopilotToken, requestCopilotApi } from './copilot-token.js';
import {
  COPILOT_OAUTH_CLIENT_ID,
  DEFAULT_CLOUD_CONCURRENCY,
  DEFAULT_COPILOT_CREDENTIAL_REF,
  DEFAULT_HEALTH_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './copilot-types.js';
import type {
  CopilotConfig,
  CopilotRuntime,
  RawChatCompletionResponse,
  RawModelsResponse,
} from './copilot-types.js';

export {
  COPILOT_OAUTH_CLIENT_ID,
  DEFAULT_COPILOT_CREDENTIAL_REF,
  type CopilotConfig,
  type CopilotCredentialStore,
  type DeviceCodeInfo,
  type DevicePollResult,
} from './copilot-types.js';
export { CopilotDeviceAuthError, CopilotSubscriptionError } from './copilot-errors.js';

export class CopilotProvider implements Provider {
  readonly id: string;
  private readonly costTable: CostTable;
  private readonly contextLengths: Record<string, number>;
  private readonly requestTimeoutMs: number;
  private readonly healthTimeoutMs: number;
  private readonly now: () => number;
  private readonly queue: RequestQueue;
  private readonly runtime: CopilotRuntime;

  constructor(config: CopilotConfig) {
    this.id = config.id ?? 'copilot';
    this.costTable = config.costTable ?? LOCAL_COST_TABLE;
    this.contextLengths = config.contextLengths ?? {};
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.healthTimeoutMs = config.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
    this.now = config.now ?? Date.now;
    this.queue = new RequestQueue(config.concurrency ?? DEFAULT_CLOUD_CONCURRENCY);
    const { fetchRaw, throwHttpError } = createHttpFns(
      this.id,
      config.fetchImpl ?? fetch,
    );
    this.runtime = {
      id: this.id,
      credentialStore: config.credentialStore,
      credentialRef: config.credentialRef ?? DEFAULT_COPILOT_CREDENTIAL_REF,
      clientId: config.clientId ?? COPILOT_OAUTH_CLIENT_ID,
      healthTimeoutMs: this.healthTimeoutMs,
      now: this.now,
      fetchRaw,
      throwHttpError,
      cachedToken: undefined,
    };
  }

  // ---- device-auth first-run flow (D-007, API_DESIGN.md POST/GET /providers/copilot/device-auth) ----

  async requestDeviceCode() {
    return requestDeviceCode(this.runtime);
  }

  async pollDeviceAuthorization(deviceCode: string, intervalMs: number) {
    return pollDeviceAuthorization(this.runtime, deviceCode, intervalMs);
  }

  // ---- Provider contract ----

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.queue.run(async () => {
      const raw = await requestCopilotApi<RawChatCompletionResponse>(
        this.runtime,
        '/chat/completions',
        { method: 'POST', body: JSON.stringify(buildChatRequestBody(request)) },
        this.requestTimeoutMs,
      );
      return parseChatCompletion(this.id, raw, request, this.costTable);
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    const raw = await requestCopilotApi<RawModelsResponse>(
      this.runtime,
      '/models',
      { method: 'GET' },
      this.healthTimeoutMs,
    );
    return parseModelsList(raw, this.contextLengths);
  }

  async getContextLength(modelId: string): Promise<number | undefined> {
    return this.contextLengths[modelId];
  }

  async health(): Promise<ProviderHealth> {
    const start = this.now();
    try {
      await ensureCopilotToken(this.runtime);
      return {
        status: 'ok',
        latencyMs: this.now() - start,
        checkedAt: new Date(this.now()).toISOString(),
      };
    } catch (err) {
      if (
        err instanceof ProviderUnreachableError ||
        err instanceof ProviderTimeoutError
      ) {
        return {
          status: 'unreachable',
          latencyMs: this.now() - start,
          checkedAt: new Date(this.now()).toISOString(),
          detail: err.message,
        };
      }
      if (err instanceof ProviderHttpError || err instanceof CopilotSubscriptionError) {
        return {
          status: 'error',
          latencyMs: this.now() - start,
          checkedAt: new Date(this.now()).toISOString(),
          detail: err.message,
        };
      }
      throw err;
    }
  }

  async warmUp(): Promise<ProviderHealth> {
    return this.health();
  }

  queueStats(): ProviderQueueStats {
    return {
      active: this.queue.activeCount,
      queued: this.queue.queuedCount,
      concurrency: this.queue.concurrency,
    };
  }
}

export function createCopilotProvider(config: CopilotConfig): CopilotProvider {
  return new CopilotProvider(config);
}
