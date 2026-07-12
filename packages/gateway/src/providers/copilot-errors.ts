/** Copilot-specific error classes: device-flow rejection and subscription-access gaps. */

/** GitHub rejected the device flow itself (denied, expired, misconfigured client) — distinct from a subscription-access problem. */
export class CopilotDeviceAuthError extends Error {
  constructor(
    public readonly code: string,
    public readonly description?: string,
  ) {
    super(
      `GitHub device authorization failed (${code})${description ? `: ${description}` : ''}`,
    );
    this.name = 'CopilotDeviceAuthError';
  }
}

/** The credential is valid but the plan itself lacks Copilot API/chat access — distinct from ProviderAuthError (bad/expired credential). */
export class CopilotSubscriptionError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly remediation: string,
    public readonly detail?: string,
  ) {
    super(
      `${providerId}: GitHub Copilot subscription does not include API/chat access` +
        `${detail ? ` (${detail})` : ''}. ${remediation}`,
    );
    this.name = 'CopilotSubscriptionError';
  }
}

export const SUBSCRIPTION_REMEDIATION =
  'Enable Copilot Chat/API access for this account (or ask your GitHub organization admin ' +
  'to grant the "Editor Preview Features" policy), confirm your plan includes Copilot Chat ' +
  'at https://github.com/settings/copilot, then run device sign-in again.';
