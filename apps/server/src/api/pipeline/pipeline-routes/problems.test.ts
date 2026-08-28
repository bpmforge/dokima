/**
 * A slow or absent local model is an EXPECTED outcome for a product that
 * guarantees local-only works (C-1, D-024 option a) — `isProviderError`'s own
 * comment says so, written after W13-13 watched a 27B model blow the 300s
 * request timeout and kill a run that had already produced verified work.
 *
 * That lesson reached the land loop and not these routes. Measured live
 * 2026-08-28, resuming the guided sample after answering its three founder
 * decisions: HTTP 500, body `{"statusCode":500,"error":"Internal Server
 * Error","message":"lm-studio: request timed out after 300000ms"}` — Fastify's
 * default envelope, because no mapping matched and the error was rethrown.
 * That envelope has no `detail` and no `rule`, so the browser could not read
 * the reason and told the person to check that their model was running. It
 * was running. It was slow.
 */
import { describe, expect, it } from 'vitest';
import { ProviderTimeoutError, ProviderUnreachableError } from '@dokima/gateway';
import { problemForError } from './problems.js';

const request = { url: '/api/v1/projects/p1/pipeline/r1/resume', id: 'req-1' } as never;

describe('problemForError: a provider that is slow or absent', () => {
  it('RED FIXTURE: a provider timeout is a problem+json 504, not an unhandled 500', () => {
    const problem = problemForError(new ProviderTimeoutError('lm-studio', 300_000), request);

    expect(problem).toBeDefined();
    expect(problem?.status).toBe(504);
    expect(problem?.body.rule).toBe('MODEL_TIMEOUT');
    // The browser reads `detail`; Fastify's default envelope carries `message`,
    // which is exactly why the reason never reached the screen.
    expect(String(problem?.body.detail)).toContain('timed out after 300000ms');
    expect(problem?.body.type).toBe('https://dokima.dev/errors/model-timeout');
  });

  it('an unreachable endpoint is a 503 naming itself', () => {
    const problem = problemForError(
      new ProviderUnreachableError('lm-studio', new Error('fetch failed')),
      request,
    );

    expect(problem?.status).toBe(503);
    expect(problem?.body.rule).toBe('MODEL_UNREACHABLE');
    expect(String(problem?.body.detail)).toContain('unreachable');
  });

  it('an error with no mapping is still undefined — this widens the map, it does not swallow', () => {
    expect(problemForError(new Error('something we did wrong'), request)).toBeUndefined();
  });
});
