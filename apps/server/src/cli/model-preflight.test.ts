/**
 * W21-78. The founder's ask was "make sure qwen3.6-35b-a3b is never used".
 * No code selected it — a stale every-project default did, and nothing checked
 * it against what the provider serves.
 */
import { describe, expect, it } from 'vitest';
import { ModelResolutionError } from '../api/pipeline/model-resolution.js';
import { assertModelIsServed, modelNotServed } from './model-preflight.js';

const lister = (ids: string[], id = 'lm-studio') => ({
  id,
  listModels: async () => ids.map((m) => ({ id: m })),
});

const LM_STUDIO = ['qwen/qwen3-coder-next', 'qwen/qwen3.8-27b', 'google/gemma-4-e4b'];

describe('a model the provider does not serve is refused before anything is claimed', () => {
  it('refuses, naming the model and the provider', async () => {
    await expect(
      assertModelIsServed(lister(LM_STUDIO), 'qwen3.6-35b-a3b'),
    ).rejects.toThrow(ModelResolutionError);
  });

  it('the refusal names models the provider DOES serve, so it is actionable', async () => {
    const error = modelNotServed('qwen3.6-35b-a3b', 'lm-studio', LM_STUDIO);
    expect(error.message).toContain('qwen/qwen3-coder-next');
    expect(error.message).toContain('lm-studio');
    expect(error.rule).toBe('model-not-served');
  });

  it('says plainly that nothing ran', async () => {
    const error = modelNotServed('nope', 'lm-studio', LM_STUDIO);
    expect(error.message).toContain('Nothing was claimed and no session ran');
  });

  it('a served model passes through untouched', async () => {
    await expect(
      assertModelIsServed(lister(LM_STUDIO), 'qwen/qwen3-coder-next'),
    ).resolves.toBeUndefined();
  });
});

describe('silence is not a refusal (FR-G5)', () => {
  it('a provider that enumerates nothing is left to the request path', async () => {
    await expect(assertModelIsServed(lister([]), 'anything')).resolves.toBeUndefined();
  });

  it('a provider that cannot be reached is left to the request path, which reports it precisely', async () => {
    const unreachable = {
      id: 'lm-studio',
      listModels: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    await expect(assertModelIsServed(unreachable, 'anything')).resolves.toBeUndefined();
  });

  it('an empty model id is not this check’s business', async () => {
    await expect(assertModelIsServed(lister(LM_STUDIO), '')).resolves.toBeUndefined();
  });
});

describe('the suggestion prefers near-misses', () => {
  it('a bare id suggests the provider-qualified one', () => {
    const error = modelNotServed('qwen3.8-27b', 'lm-studio', LM_STUDIO);
    expect(error.message).toContain('qwen/qwen3.8-27b');
  });
});
