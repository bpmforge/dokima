import { describe, expect, it } from 'vitest';
import { redactDeep, redactPatterns, redactString, redactValues } from './redact.js';

describe('redactPatterns', () => {
  it('redacts a GitHub token', () => {
    const text = 'token=ghp_1234567890abcdef1234567890abcdef1234';
    expect(redactPatterns(text)).toBe('token=[REDACTED:github-token]');
  });

  it('redacts an AWS access key id', () => {
    expect(redactPatterns('key=AKIAABCDEFGHIJKLMNOP')).toBe(
      'key=[REDACTED:aws-access-key-id]',
    );
  });

  it('redacts an OpenAI/Anthropic-style sk- key', () => {
    expect(redactPatterns('sk-abcdefghijklmnopqrstuvwx')).toBe(
      '[REDACTED:openai-style-key]',
    );
  });

  it('redacts a Slack token', () => {
    expect(redactPatterns('xoxb-123456789012-abcdefghij')).toBe('[REDACTED:slack-token]');
  });

  it('redacts a PEM private-key block, including embedded newlines', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA...',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    expect(redactPatterns(pem)).toBe('[REDACTED:pem-private-key]');
  });

  it('redacts a database connection string with embedded credentials', () => {
    // The pattern stops at the userinfo@host:port boundary -- it doesn't
    // consume the path, which is not itself secret.
    const uri = 'postgresql://appuser:hunter2secret@db.internal:5432/app';
    expect(redactPatterns(uri)).toBe('[REDACTED:db-connection-credentials]/app');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'Deploying the app to staging, no secrets in this line.';
    expect(redactPatterns(text)).toBe(text);
  });
});

describe('redactValues', () => {
  it('replaces exact occurrences of a registered secret value', () => {
    expect(
      redactValues('the api key is my-super-secret-value', ['my-super-secret-value']),
    ).toBe('the api key is [REDACTED:secret]');
  });

  it('prefers the longer value when one is a substring of another', () => {
    const result = redactValues('prefix-longer-secret-suffix', [
      'longer-secret',
      'longer-secret-suffix',
    ]);
    expect(result).toBe('prefix-[REDACTED:secret]');
  });

  it('skips values shorter than the minimum redactable length', () => {
    expect(redactValues('the port is 8080', ['8080'])).toBe('the port is 8080');
  });
});

describe('redactString', () => {
  it('applies both pattern- and value-based redaction', () => {
    const text =
      'gh=ghp_1234567890abcdef1234567890abcdef1234 custom=my-registered-secret';
    expect(redactString(text, ['my-registered-secret'])).toBe(
      'gh=[REDACTED:github-token] custom=[REDACTED:secret]',
    );
  });
});

describe('redactDeep', () => {
  it('redacts string leaves anywhere in a nested object/array', () => {
    const packet = {
      role: 'system',
      messages: [
        { text: 'sk-abcdefghijklmnopqrstuvwx' },
        { text: 'nothing secret here' },
      ],
      meta: { env: { TOKEN: 'ghp_1234567890abcdef1234567890abcdef1234' } },
    };
    const redacted = redactDeep(packet);
    expect(redacted.messages[0]?.text).toBe('[REDACTED:openai-style-key]');
    expect(redacted.messages[1]?.text).toBe('nothing secret here');
    expect(redacted.meta.env.TOKEN).toBe('[REDACTED:github-token]');
  });

  it('redacts registered secret values passed alongside the pattern set', () => {
    const payload = { note: 'my-registered-secret leaked here' };
    expect(redactDeep(payload, ['my-registered-secret'])).toEqual({
      note: '[REDACTED:secret] leaked here',
    });
  });

  it('passes through non-string primitives unchanged', () => {
    const payload = { count: 3, active: true, nothing: null };
    expect(redactDeep(payload)).toEqual(payload);
  });
});
