/**
 * receipts/waiver-policy.ts — FR-P2 human-signer policy: the agent-name blocklist and its refusals.
 *
 * Chapter of the 553-line packages/events/src/receipts.ts, split under the
 * 400-line CODE_BOOK_PROTOCOL cap (W10-47). Extraction only: the byte
 * sequence every MAC is computed over is unchanged, and receipts-golden.test.ts
 * pins that with hex values frozen from the pre-split implementation.
 */


/**
 * Waiver receipts require a human signer (FR-P2). `kind !== 'human'` on the
 * resolved identity is the load-bearing check; DEFAULT_AGENT_NAME_BLOCKLIST
 * is defense-in-depth for a mislabeled identity, so keep it conservative —
 * broad substrings (e.g. "ai") false-positive on ordinary human names.
 */
export const DEFAULT_AGENT_NAME_BLOCKLIST: readonly string[] = [
  'agent',
  'claude',
  'gpt',
  'copilot',
  'bot',
  'assistant',
];

export function isBlockedAgentName(name: string, blocklist: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return blocklist.some((term) => lower.includes(term.toLowerCase()));
}

export class WaiverSignatureRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiverSignatureRequiredError';
  }
}

export class AgentWaiverRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentWaiverRejectedError';
  }
}

