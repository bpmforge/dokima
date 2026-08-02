/**
 * Wire shapes, config, and the internal runtime context shared across the
 * copilot/ chapters. See index.ts for the adapter overview and citations.
 */
import type { CostTable } from './usage.js';

/** Structurally identical to packages/shared's CredentialStore — see index.ts re: write_scope. */
export interface CopilotCredentialStore {
  get(ref: string): Promise<string | undefined>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

export interface CopilotConfig {
  id?: string;
  /** Where the long-lived GitHub OAuth token is persisted/read (FR-S2) — never resolved here from a keychain directly, see index.ts. */
  credentialStore: CopilotCredentialStore;
  /** Matches packages/shared's naming convention (see index.ts). */
  credentialRef?: string;
  /** GitHub OAuth app client id for the device flow; defaults to the public VS Code Copilot Chat app id (see index.ts — not a secret). */
  clientId?: string;
  costTable?: CostTable;
  contextLengths?: Record<string, number>;
  concurrency?: number;
  requestTimeoutMs?: number;
  healthTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Clock injection for deterministic token-expiry tests. */
  now?: () => number;
}

export const GITHUB_BASE_URL = 'https://github.com';
export const GITHUB_API_BASE_URL = 'https://api.github.com';
export const DEFAULT_COPILOT_API_BASE_URL = 'https://api.githubcopilot.com';
export const COPILOT_OAUTH_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
export const DEFAULT_COPILOT_CREDENTIAL_REF = 'dokima:copilot:github-token';
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;
/** Cloud APIs support real parallelism, unlike a single-model local server (RequestQueue's default of 1); kept conservative and fully configurable since neither vendor publishes a universal safe number. */
export const DEFAULT_CLOUD_CONCURRENCY = 4;
/** Refresh this long before actual expiry so a request never races a token that dies mid-flight. */
export const TOKEN_REFRESH_BUFFER_MS = 60_000;
export const EDITOR_VERSION = 'Dokima/0.1.0';
export const EDITOR_PLUGIN_VERSION = 'dokima-gateway/0.1.0';
export const USER_AGENT = 'Dokima-Gateway/0.1.0';
export const COPILOT_INTEGRATION_ID = 'vscode-chat';

export interface DeviceCodeInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DevicePollResult =
  { status: 'pending'; intervalMs: number } | { status: 'complete' };

export interface RawChatChoice {
  index: number;
  message: { role: string; content: string | null };
  finish_reason: string | null;
}

export interface RawChatCompletionResponse {
  id?: string;
  model?: string;
  choices: RawChatChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface RawModel {
  id: string;
}

export interface RawModelsResponse {
  data: RawModel[];
}

export interface CopilotTokenResponse {
  token?: string;
  expires_at?: number;
  endpoints?: { api?: string };
}

export interface DeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
}

export interface AccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export interface CachedCopilotToken {
  token: string;
  apiBase: string;
  expiresAtMs: number;
}

/**
 * Shared dependencies + mutable token cache passed to every chapter
 * function — a plain object (not class-private fields) so free functions
 * outside the CopilotProvider class body can read/write it.
 */
export interface CopilotRuntime {
  readonly id: string;
  readonly credentialStore: CopilotCredentialStore;
  readonly credentialRef: string;
  readonly clientId: string;
  readonly healthTimeoutMs: number;
  readonly now: () => number;
  readonly fetchRaw: (
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ) => Promise<Response>;
  readonly throwHttpError: (response: Response) => Promise<never>;
  cachedToken: CachedCopilotToken | undefined;
}
