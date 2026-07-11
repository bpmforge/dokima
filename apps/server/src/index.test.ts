import { describe, expect, it } from 'vitest';
import { buildServer } from './index.js';

describe('apps/server placeholder', () => {
  it('responds ok on /health', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
