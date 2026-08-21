import { describe, expect, it } from 'vitest';
import { SECRET_PATTERNS } from '@dokima/shared';
import { parseMcpServersSetting } from './settings-types.js';

const looksLikeSecret = (value: string) =>
  SECRET_PATTERNS.some((p) => new RegExp(p.regex.source).test(value));

/** Assembled at runtime, never a literal (validate-history-secrets). */
const PLANTED_KEY = ['sk', '0123456789abcdef0123'].join('-');

describe('parseMcpServersSetting (W14-02)', () => {
  it('accepts a well-formed entry and defaults the optional fields', () => {
    const result = parseMcpServersSetting(
      [{ id: 'docs-server', command: 'npx', args: ['some-mcp'], env: { TOKEN: 'my-ref' } }],
      looksLikeSecret,
    );
    expect(result).toEqual({
      servers: [
        {
          id: 'docs-server',
          command: 'npx',
          args: ['some-mcp'],
          env: { TOKEN: 'my-ref' },
        },
      ],
    });
  });

  it('an absent setting is an empty fleet, not an error', () => {
    expect(parseMcpServersSetting(undefined, looksLikeSecret)).toEqual({ servers: [] });
  });

  it.each([
    [[{ command: 'x' }], /invalid id/],
    [[{ id: 'a', command: 'x' }, { id: 'a', command: 'y' }], /appears twice/],
    [[{ id: 'a', command: '  ' }], /no command/],
    [[{ id: 'a', command: 'x', env: { K: 7 } }], /must be a string ref/],
    ['not-an-array', /must be an array/],
  ])('refuses malformed input with a named reason: %j', (raw, expected) => {
    const result = parseMcpServersSetting(raw, looksLikeSecret);
    expect('refusal' in result && result.refusal).toMatch(expected);
  });

  it('RED FIXTURE (Law 8): a raw credential-shaped env value is refused outright — the vault name goes here, never the secret', () => {
    const result = parseMcpServersSetting(
      [{ id: 'a', command: 'x', env: { API_KEY: PLANTED_KEY } }],
      looksLikeSecret,
    );
    expect('refusal' in result && result.refusal).toMatch(/looks like a raw credential/);
    expect('refusal' in result && result.refusal).toMatch(/vault/);
    // The refusal itself must not echo the secret back.
    expect('refusal' in result ? result.refusal : '').not.toContain(PLANTED_KEY);
  });
});
