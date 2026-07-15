import { describe, expect, it } from 'vitest';
import { buildAllowlist, isAllowedHost, isAllowedOrigin } from './allowlist.js';

describe('allowlist', () => {
  const allowlist = buildAllowlist(4317);

  it('allows exact localhost/127.0.0.1 hosts for the bound port', () => {
    expect(isAllowedHost('127.0.0.1:4317', allowlist)).toBe(true);
    expect(isAllowedHost('localhost:4317', allowlist)).toBe(true);
  });

  it('rejects an evil or mismatched Host header', () => {
    expect(isAllowedHost('evil.example.com:4317', allowlist)).toBe(false);
    expect(isAllowedHost('127.0.0.1:9999', allowlist)).toBe(false);
    expect(isAllowedHost(undefined, allowlist)).toBe(false);
  });

  it('allows a missing Origin header (non-browser clients)', () => {
    expect(isAllowedOrigin(undefined, allowlist)).toBe(true);
  });

  it('allows exact localhost/127.0.0.1 origins for the bound port', () => {
    expect(isAllowedOrigin('http://127.0.0.1:4317', allowlist)).toBe(true);
    expect(isAllowedOrigin('http://localhost:4317', allowlist)).toBe(true);
  });

  it('rejects an evil or mismatched Origin header', () => {
    expect(isAllowedOrigin('https://evil.example.com', allowlist)).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1:9999', allowlist)).toBe(false);
  });
});
