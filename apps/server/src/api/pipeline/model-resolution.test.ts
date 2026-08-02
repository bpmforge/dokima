import { describe, expect, it } from 'vitest';
import { SameModelRefusedError, type ProviderEntry } from '@dokima/gateway';
import {
  matrixFromRows,
  ModelResolutionError,
  resolveModelTarget,
  splitModelRef,
} from './model-resolution.js';
import type { ModelMatrixRow } from '../server/settings-types.js';

const PROJECT = '/tmp/does-not-matter-stores-are-injected';

function row(role: string, model: string, taskType = 'reasoning'): ModelMatrixRow {
  return {
    role,
    taskType: taskType as ModelMatrixRow['taskType'],
    model,
    fallback: [],
    updatedAt: '2026-08-02T00:00:00Z',
  };
}

function provider(id: string, over: Partial<ProviderEntry> = {}): ProviderEntry {
  return {
    id,
    kind: 'oai-compat',
    baseUrl: `http://127.0.0.1:1234/${id}`,
    enabled: true,
    ...over,
  } as ProviderEntry;
}

function stores(providers: ProviderEntry[], rows: ModelMatrixRow[]) {
  return {
    loadProviders: async () => providers,
    loadMatrixRows: async () => rows,
  };
}

describe('splitModelRef', () => {
  it('splits <providerId>/<model> and leaves an unprefixed model alone', () => {
    expect(splitModelRef('box-b/qwen-32b')).toEqual({
      providerId: 'box-b',
      model: 'qwen-32b',
    });
    expect(splitModelRef('qwen-32b')).toEqual({ model: 'qwen-32b' });
  });
});

describe('resolveModelTarget — THE SEAM (W10-03)', () => {
  /**
   * THE ACCEPTANCE TEST. Set the matrix to provider B; the call must go to B.
   * Before this ticket the answer was always the env default regardless of
   * what the matrix said, because no call site read the matrix at all.
   */
  it('routes to the provider the MATRIX names, not the env default', async () => {
    const target = await resolveModelTarget({
      projectPath: PROJECT,
      role: 'coding-agent',
      taskType: 'reasoning',
      env: {
        DOKIMA_MODEL_BASE_URL: 'http://env-default:9999/v1',
        DOKIMA_MODEL_ID: 'env-model',
      },
      ...stores(
        [provider('box-a'), provider('box-b')],
        [row('coding-agent', 'box-b/qwen-32b')],
      ),
    });
    expect(target.source).toBe('registry');
    expect(target.providerId).toBe('box-b');
    expect(target.model).toBe('qwen-32b');
    expect(target.baseUrl).toBe('http://127.0.0.1:1234/box-b');
  });

  it('an explicit selection BEATS the env override (precedence, both directions)', async () => {
    const env = {
      DOKIMA_MODEL_BASE_URL: 'http://env-default:9999/v1',
      DOKIMA_MODEL_ID: 'env-model',
    };
    const chosen = await resolveModelTarget({
      projectPath: PROJECT,
      role: 'coding-agent',
      taskType: 'reasoning',
      env,
      ...stores([provider('box-a')], [row('coding-agent', 'box-a/local-a')]),
    });
    expect(chosen.model).toBe('local-a');

    // ...and with nothing configured, env still wins — a first run with no
    // registry must keep working offline (C-1), not hard-fail.
    const fallback = await resolveModelTarget({
      projectPath: PROJECT,
      role: 'coding-agent',
      taskType: 'reasoning',
      env,
      ...stores([], []),
    });
    expect(fallback.source).toBe('env');
    expect(fallback.model).toBe('env-model');
  });

  it('per-task-type routing overrides the role default', async () => {
    const target = await resolveModelTarget({
      projectPath: PROJECT,
      role: 'coding-agent',
      taskType: 'code',
      ...stores(
        [provider('box-a'), provider('box-b')],
        [
          row('coding-agent', 'box-a/general'),
          row('coding-agent', 'box-b/coder', 'code'),
        ],
      ),
    });
    expect(target.providerId).toBe('box-b');
    expect(target.model).toBe('coder');
  });

  /** C-4 / Law 5: wiring the registry in must NOT become a way around the guard. */
  it('still refuses a verifier landing on the maker model (maker != verifier stays structural)', async () => {
    await expect(
      resolveModelTarget({
        projectPath: PROJECT,
        role: 'code-reviewer',
        taskType: 'reasoning',
        ...stores(
          [provider('box-a')],
          [row('coding-agent', 'box-a/same'), row('code-reviewer', 'box-a/same')],
        ),
      }),
    ).rejects.toBeInstanceOf(SameModelRefusedError);
  });

  it('refuses a matrix row naming a provider that is not registered', async () => {
    await expect(
      resolveModelTarget({
        projectPath: PROJECT,
        role: 'coding-agent',
        taskType: 'reasoning',
        ...stores([provider('box-a')], [row('coding-agent', 'ghost/model')]),
      }),
    ).rejects.toMatchObject({ rule: 'unknown-provider' });
  });

  it('refuses a DISABLED provider rather than silently using it', async () => {
    await expect(
      resolveModelTarget({
        projectPath: PROJECT,
        role: 'coding-agent',
        taskType: 'reasoning',
        ...stores(
          [provider('off', { enabled: false })],
          [row('coding-agent', 'off/model')],
        ),
      }),
    ).rejects.toBeInstanceOf(ModelResolutionError);
  });

  it('reports an ambiguous unprefixed model rather than guessing a provider', async () => {
    await expect(
      resolveModelTarget({
        projectPath: PROJECT,
        role: 'coding-agent',
        taskType: 'reasoning',
        ...stores([provider('a'), provider('b')], [row('coding-agent', 'bare-model')]),
      }),
    ).rejects.toMatchObject({ rule: 'ambiguous-provider' });
  });

  it('accepts an unprefixed model when exactly one provider is enabled', async () => {
    const target = await resolveModelTarget({
      projectPath: PROJECT,
      role: 'coding-agent',
      taskType: 'reasoning',
      ...stores(
        [provider('only'), provider('off', { enabled: false })],
        [row('coding-agent', 'bare-model')],
      ),
    });
    expect(target.providerId).toBe('only');
    expect(target.model).toBe('bare-model');
  });

  it('with no project in view, resolves env-only', async () => {
    const target = await resolveModelTarget({
      role: 'coding-agent',
      taskType: 'reasoning',
      env: { DOKIMA_MODEL_ID: 'no-project' },
    });
    expect(target.source).toBe('env');
    expect(target.model).toBe('no-project');
  });
});

describe('matrixFromRows', () => {
  it('carries both the role default and its task-type overrides', () => {
    const m = matrixFromRows([
      row('coding-agent', 'p/base'),
      row('coding-agent', 'p/coder', 'code'),
    ]) as { project: Record<string, { default: unknown; taskTypes: unknown }> };
    expect(m.project['coding-agent']?.default).toEqual({
      model: 'p/base',
      fallbackChain: [],
    });
    expect(m.project['coding-agent']?.taskTypes).toMatchObject({
      code: { model: 'p/coder' },
    });
  });
});
