import { afterEach, describe, expect, it } from 'vitest';
import { buildSandboxEnv } from './env.js';

describe('buildSandboxEnv', () => {
  const originalSecret = process.env.DOKIMA_TEST_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.DOKIMA_TEST_SECRET;
    else process.env.DOKIMA_TEST_SECRET = originalSecret;
  });

  it('never carries an arbitrary ambient var through, even one that looks like a credential', () => {
    process.env.DOKIMA_TEST_SECRET = 'sk-should-never-leak';
    const env = buildSandboxEnv();
    expect(env.DOKIMA_TEST_SECRET).toBeUndefined();
  });

  it('carries through only the safe allowlist (PATH survives, HOME survives)', () => {
    const env = buildSandboxEnv();
    if (process.env.PATH !== undefined) expect(env.PATH).toBe(process.env.PATH);
    expect(Object.keys(env).every((key) => key !== 'DOKIMA_TEST_SECRET')).toBe(true);
  });

  it('layers explicit extra env over the baseline without reintroducing ambient vars', () => {
    process.env.DOKIMA_TEST_SECRET = 'sk-should-never-leak';
    const env = buildSandboxEnv({ PROJECT_FLAG: 'on' });
    expect(env.PROJECT_FLAG).toBe('on');
    expect(env.DOKIMA_TEST_SECRET).toBeUndefined();
  });

  it('extra env can override an allowlisted key', () => {
    const env = buildSandboxEnv({ PATH: '/custom/bin' });
    expect(env.PATH).toBe('/custom/bin');
  });
});
