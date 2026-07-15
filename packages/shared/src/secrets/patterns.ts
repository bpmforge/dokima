/**
 * Known live-credential shapes (SC-06, BLUEPRINT §12.5): gh tokens, PEM
 * private-key blocks, AWS access key ids, OpenAI/Anthropic-style `sk-`
 * keys, Slack tokens, DB connection strings with embedded credentials.
 * Categorically aligned with the write-path guard in
 * `packages/shared/src/config/settings-files.ts` (`SECRET_LIKE_PATTERNS`)
 * — that list is a boolean settings-file guard; this one is named per
 * category (for gap reporting) and global-flagged (for redaction
 * replacement), so it cannot simply import that one.
 */
export interface SecretPattern {
  readonly category: string;
  readonly regex: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    category: 'pem-private-key',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { category: 'openai-style-key', regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { category: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { category: 'aws-access-key-id', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { category: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  {
    category: 'db-connection-credentials',
    regex:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/g,
  },
];
