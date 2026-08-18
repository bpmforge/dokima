import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SameModelRefusedError, type ProviderEntry } from '@dokima/gateway';
import {
  matrixFromRows,
  ModelResolutionError,
  resolveModelTarget,
  splitModelRef,
} from './model-resolution.js';
import {
  listModelMatrix,
  migrateLegacyModelMatrixRows,
  putModelMatrix,
} from '../server/model-matrix-store.js';
import type { ModelMatrixRow } from '../server/settings-types.js';

const PROJECT = '/tmp/does-not-matter-stores-are-injected';

function row(
  role: string,
  model: string,
  taskType = 'reasoning',
  providerId?: string,
): ModelMatrixRow {
  return {
    role,
    taskType: taskType as ModelMatrixRow['taskType'],
    providerId,
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
  const KNOWN = ['box-a', 'box-b', 'copilot'];

  it('splits <providerId>/<model> and leaves an unprefixed model alone', () => {
    expect(splitModelRef('box-b/qwen-32b', KNOWN)).toEqual({
      providerId: 'box-b',
      model: 'qwen-32b',
    });
    expect(splitModelRef('qwen-32b', KNOWN)).toEqual({ model: 'qwen-32b' });
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

  /**
   * CHANGED BY W10-60, deliberately and with a cost — read before "fixing".
   *
   * This used to assert `unknown-provider` for `ghost/model`. It cannot any
   * more, and the reason is that the two readings are the same string:
   * `ghost/model` is indistinguishable from `qwen/qwen3-coder-next`, a real
   * model id from this machine's LM Studio. One of them has to win when the
   * prefix is unregistered, and the vendor-namespaced reading wins because it
   * is the one users actually hit — 8 of 23 models in a live catalog carry a
   * slash, and every one of them was unusable while this refusal stood.
   *
   * THE COST, stated rather than hidden: a matrix row whose provider prefix is
   * a typo, or names a provider since removed, now binds to the single enabled
   * provider instead of refusing. It is bounded — with two or more enabled
   * providers it is still `ambiguous-provider`, and a registered-but-disabled
   * prefix is still `unknown-provider` (both asserted below) — but it is real.
   *
   * The ambiguity is not resolvable from a string at all, so W10-68 removes
   * the string: the matrix stores providerId and model as a structured pair.
   * That is the fix; this is the trade until it lands.
   */
  it('binds an unregistered prefix as part of the model id, not as a provider (W10-60)', async () => {
    const target = await resolveModelTarget({
      projectPath: PROJECT,
      role: 'coding-agent',
      taskType: 'reasoning',
      ...stores([provider('box-a')], [row('coding-agent', 'ghost/model')]),
    });

    expect(target.providerId).toBe('box-a');
    expect(target.model).toBe('ghost/model');
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

/**
 * W10-60 red fixtures. The failure was not hypothetical: of the 23 models a
 * live LM Studio served this machine, 8 carry a slash of their own, and every
 * one resolved to a providerId that does not exist. The W10-04 panel offered
 * them; the resolver refused them.
 *
 * Both directions, because a resolver that never refuses is not a resolver:
 * a vendor-namespaced id must bind and reach the wire INTACT, and a genuinely
 * unknown provider prefix must still raise `unknown-provider`.
 */
describe('vendor-namespaced model ids bind to the single enabled provider (W10-60)', () => {
  const NAMESPACED = [
    'qwen/qwen3-coder-next',
    'qwen/qwen3.5-9b',
    'google/gemma-4-12b-qat',
    'nvidia/nemotron-3-nano',
    'mlx-community/nemotron-3-nano-omni-30b-a3b-reasoning',
  ];

  for (const modelId of NAMESPACED) {
    it(`resolves "${modelId}" and sends the FULL id on the wire`, async () => {
      const target = await resolveModelTarget({
        projectPath: PROJECT,
        role: 'coding-agent',
        taskType: 'reasoning',
        ...stores([provider('lm-studio')], [row('coding-agent', modelId)]),
      });

      expect(target.providerId).toBe('lm-studio');
      expect(target.model).toBe(modelId); // NOT truncated at the first slash
      expect(target.source).toBe('registry');
    });
  }

  it('a REGISTERED prefix is still honoured — the copilot/ convention keeps working', async () => {
    const target = await resolveModelTarget({
      projectPath: PROJECT,
      role: 'coding-agent',
      taskType: 'reasoning',
      ...stores(
        [provider('lm-studio'), provider('box-b')],
        [row('coding-agent', 'box-b/qwen-32b')],
      ),
    });

    expect(target.providerId).toBe('box-b');
    expect(target.model).toBe('qwen-32b');
  });

  it('an unknown prefix with SEVERAL enabled providers is ambiguous, not a guess', async () => {
    await expect(
      resolveModelTarget({
        projectPath: PROJECT,
        role: 'coding-agent',
        taskType: 'reasoning',
        ...stores(
          [provider('box-a'), provider('box-b')],
          [row('coding-agent', 'qwen/qwen3.5-9b')],
        ),
      }),
    ).rejects.toBeInstanceOf(ModelResolutionError);
  });

  it('a REGISTERED but DISABLED prefix still reports unknown-provider, never reinterpreted as a model name', async () => {
    // The dangerous silent path: if recognition used only ENABLED ids,
    // "off-box/model" would look like a bare model name and get sent to
    // whichever provider happened to be the only enabled one.
    await expect(
      resolveModelTarget({
        projectPath: PROJECT,
        role: 'coding-agent',
        taskType: 'reasoning',
        ...stores(
          [provider('lm-studio'), provider('off-box', { enabled: false })],
          [row('coding-agent', 'off-box/some-model')],
        ),
      }),
    ).rejects.toThrow(/off-box/);
  });
});

/**
 * W10-68 RED FIXTURES (acceptance 5): the structured `provider_id` pair
 * removes the ambiguity a slash-in-a-string could never resolve, restoring
 * the refusal W10-60 had to trade away for an EXPLICIT selection while
 * leaving that trade's bounded regression in place for rows that predate
 * this ticket (asserted above, unchanged).
 */
describe('the structured provider_id pair (W10-68)', () => {
  it('an explicit providerId resolves to exactly that provider with the full model id intact, even when the model id has its own slash', async () => {
    const target = await resolveModelTarget({
      projectPath: PROJECT,
      role: 'coding-agent',
      taskType: 'reasoning',
      ...stores(
        [provider('lm-studio'), provider('box-b')],
        [row('coding-agent', 'qwen/qwen3-coder-next', 'reasoning', 'lm-studio')],
      ),
    });
    expect(target.providerId).toBe('lm-studio');
    expect(target.model).toBe('qwen/qwen3-coder-next'); // NOT split on its own slash
    expect(target.source).toBe('registry');
  });

  it('a providerId naming an unregistered provider raises unknown-provider again — the refusal W10-60 traded away', async () => {
    await expect(
      resolveModelTarget({
        projectPath: PROJECT,
        role: 'coding-agent',
        taskType: 'reasoning',
        ...stores(
          [provider('box-a')],
          [row('coding-agent', 'some-model', 'reasoning', 'ghost')],
        ),
      }),
    ).rejects.toMatchObject({ rule: 'unknown-provider' });
  });

  /**
   * W10-68 acceptance 5's third clause, exercised against the REAL store
   * (not `stores()`'s stubs): a row written before this ticket must resolve
   * to the identical target both before `migrateLegacyModelMatrixRows` runs
   * (via the `bindProvider` fallback, W10-60's rule applied live) and after
   * (via the row's own persisted `provider_id`, applied directly). A
   * migration that changed which model a run calls would be worse than the
   * bug it fixes (acceptance 4).
   */
  it('a pre-migration string row resolves to the same target before and after migrating', async () => {
    const home = await fs.mkdtemp(
      path.join(os.tmpdir(), 'dokima-model-resolution-home-'),
    );
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'dokima-model-resolution-project-'),
    );
    const savedHome = process.env.DOKIMA_HOME;
    process.env.DOKIMA_HOME = home;
    try {
      await putModelMatrix(dir, [
        {
          role: 'coding-agent',
          taskType: 'reasoning',
          model: 'box-b/qwen-32b',
          fallback: [],
        },
      ]);

      const resolve = () =>
        resolveModelTarget({
          projectPath: dir,
          role: 'coding-agent',
          taskType: 'reasoning',
          loadProviders: async () => [provider('box-a'), provider('box-b')],
          loadMatrixRows: async () => listModelMatrix(dir),
        });

      const before = await resolve();
      await migrateLegacyModelMatrixRows(dir, async () => ['box-a', 'box-b']);
      const after = await resolve();

      expect(after).toEqual(before);
      expect(after).toMatchObject({ providerId: 'box-b', model: 'qwen-32b' });
    } finally {
      if (savedHome === undefined) delete process.env.DOKIMA_HOME;
      else process.env.DOKIMA_HOME = savedHome;
      await Promise.all([
        fs.rm(home, { recursive: true, force: true }),
        fs.rm(dir, { recursive: true, force: true }),
      ]);
    }
  });
});

/**
 * D-027 / W12-37. A pinned model is a ROUTING fact, expressed in the run scope
 * of the matrix — the slot that has existed since W2-05 and had never been
 * written to, because `matrixFromRows` builds `{ project: … }` only.
 */
describe('a pinned model is a run-scoped routing entry (W12-37, D-027)', () => {
  it(
    'RED FIXTURE: the pin BEATS the project row. Run > project > global is the ' +
      'FR-S1 precedence the matrix already implements, so pinning needs no new ' +
      'ordering rule — which is the whole reason D-027 put the pin here instead ' +
      'of inventing an override beside the matrix',
    async () => {
      const target = await resolveModelTarget({
        projectPath: PROJECT,
        role: 'coding-agent',
        taskType: 'reasoning',
        pin: { role: 'coding-agent', model: 'box-b/pinned-70b' },
        ...stores(
          [provider('box-a'), provider('box-b')],
          [row('coding-agent', 'box-a/qwen-32b')],
        ),
      });
      expect(target.model).toBe('pinned-70b');
      expect(target.providerId).toBe('box-b');
    },
  );

  it('pins ONE role and leaves every other role on its own row (C-4 by construction)', async () => {
    const stored = stores(
      [provider('box-a'), provider('box-b')],
      [row('coding-agent', 'box-a/qwen-32b'), row('code-reviewer', 'box-a/reviewer-8b')],
    );
    const pin = { role: 'coding-agent', model: 'box-b/pinned-70b' } as const;

    const maker = await resolveModelTarget({
      projectPath: PROJECT,
      role: 'coding-agent',
      taskType: 'reasoning',
      pin,
      ...stored,
    });
    const verifier = await resolveModelTarget({
      projectPath: PROJECT,
      role: 'code-reviewer',
      taskType: 'reasoning',
      pin,
      ...stored,
    });
    expect(maker.model).toBe('pinned-70b');
    // The verifier is NOT dragged onto the pinned model. If it were, the pin
    // would have collapsed maker != verifier silently — the exact failure
    // `guardMakerVerifierDistinct` exists to make impossible.
    expect(verifier.model).toBe('reviewer-8b');
  });

  it(
    'REFUSES BY NAME when the pin cannot be honoured, rather than quietly ' +
      'serving something else. Pinning means nothing else runs; falling back to ' +
      'the env default or the project row would be the silent substitution the ' +
      'whole mode exists to prevent',
    async () => {
      await expect(
        resolveModelTarget({
          projectPath: PROJECT,
          role: 'coding-agent',
          taskType: 'reasoning',
          // An EXPLICIT binding to a provider that is not registered. A bare
          // `no-such-box/pinned-70b` is deliberately NOT a refusal: W10-60
          // established that a slash can belong to the model id itself
          // (`qwen/…`, `mlx-community/…`), so guessing it is a dead provider
          // prefix would refuse eight of the 23 models a real LM Studio serves.
          pin: {
            role: 'coding-agent',
            model: 'pinned-70b',
            providerId: 'no-such-box',
          },
          ...stores([provider('box-a')], [row('coding-agent', 'box-a/qwen-32b')]),
        }),
      ).rejects.toThrow(/pin/i);
    },
  );

  it(
    'a vendor-namespaced pin still binds, because a slash is not proof of a ' +
      'provider prefix (W10-60). Refusing these would refuse 8 of the 23 models ' +
      'a real LM Studio serves',
    async () => {
      const target = await resolveModelTarget({
        projectPath: PROJECT,
        role: 'coding-agent',
        taskType: 'reasoning',
        pin: { role: 'coding-agent', model: 'qwen/qwen3-32b' },
        ...stores([provider('box-a')], [row('coding-agent', 'box-a/qwen-32b')]),
      });
      expect(target.model).toBe('qwen/qwen3-32b');
      expect(target.providerId).toBe('box-a');
    },
  );

  it(
    'a pin survives an EMPTY registry as a refusal, not as the env default. ' +
      'resolveModelTarget short-circuits to envTarget when nothing is ' +
      'configured — correct for a first run (C-1), and silently wrong for a ' +
      'user who asked for one specific model',
    async () => {
      await expect(
        resolveModelTarget({
          projectPath: PROJECT,
          role: 'coding-agent',
          taskType: 'reasoning',
          pin: { role: 'coding-agent', model: 'pinned-70b' },
          ...stores([], []),
        }),
      ).rejects.toThrow(/pin/i);
    },
  );

  it('no pin is exactly today\'s behaviour — 236 done tickets depend on it', async () => {
    const target = await resolveModelTarget({
      projectPath: PROJECT,
      role: 'coding-agent',
      taskType: 'reasoning',
      ...stores([provider('box-a')], [row('coding-agent', 'box-a/qwen-32b')]),
    });
    expect(target.model).toBe('qwen-32b');
  });
});
