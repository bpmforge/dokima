import { describe, expect, it } from 'vitest';
import { resolveModelChain } from './matrix.js';
import {
  buildPresetMatrix,
  PRESET_NAMES,
  PRESET_ROLES,
  PRESET_SHAPES,
  presetAsGlobalScope,
  type PresetName,
} from './presets.js';
import {
  ROLE_CHALLENGER,
  ROLE_CODE_REVIEWER,
  ROLE_CODING_AGENT,
  TASK_TYPES,
} from './types.js';
import type { ScopedRoleMatrix } from './types.js';

/**
 * The two models stand in for whatever the USER picked. W13-36 removed the
 * shipped model ids: a preset no longer names a model, so these tests supply
 * the picks the same way the setup flow does.
 */
const PICKS = { strong: 'the-users-strong-model', cheap: 'the-users-cheap-model' };

describe('FR-S3: presets All-local/Hybrid/All-cloud ship', () => {
  it('ships exactly the three named presets', () => {
    expect(Object.keys(PRESET_SHAPES).sort()).toEqual(['all-cloud', 'all-local', 'hybrid']);
  });

  it.each(Object.keys(PRESET_SHAPES) as PresetName[])(
    '%s defines every canonical role',
    (name) => {
      const shape = PRESET_SHAPES[name];
      for (const role of PRESET_ROLES) {
        expect(shape[role], `${name} is missing role '${role}'`).toBeDefined();
      }
    },
  );

  it(
    'RED FIXTURE (W13-36): NO PRESET NAMES A MODEL. They used to ship literal ' +
      'ids — qwen2.5-coder-7b-instruct, claude-opus-4-8, gpt-5.1 — and a ' +
      'customer whose provider held 26 different models got "Invalid model ' +
      'identifier" from a matrix that looked configured',
    () => {
      const serialised = JSON.stringify(PRESET_SHAPES);
      // A tier, never an id: the only strings in a shape are 'strong'/'cheap'.
      for (const value of Object.values(PRESET_SHAPES).flatMap((s) => Object.values(s))) {
        expect(['strong', 'cheap']).toContain(value);
      }
      expect(serialised).not.toMatch(/qwen|claude|gpt-|llama|mistral/i);
    },
  );

  it('presetAsGlobalScope builds the scope from the caller’s own picks', () => {
    expect(presetAsGlobalScope('hybrid', PICKS)).toEqual({
      global: buildPresetMatrix(PRESET_SHAPES.hybrid, PICKS),
    });
  });

  /** W10-42: pins the exact list apps/web/src/settings/types.ts hand-mirrors as MODEL_MATRIX_PRESETS. */
  it('PRESET_NAMES is Object.keys(PRESET_SHAPES), typed', () => {
    expect(PRESET_NAMES).toEqual(['all-local', 'hybrid', 'all-cloud']);
  });

  it('a role falls back to the other tier, so one unloaded model does not end a run', () => {
    const matrix = buildPresetMatrix(PRESET_SHAPES['all-local'], PICKS);
    expect(matrix[ROLE_CODING_AGENT]?.default.fallbackChain).toEqual([PICKS.strong]);
    expect(matrix[ROLE_CODE_REVIEWER]?.default.fallbackChain).toEqual([PICKS.cheap]);
  });

  it('and does not list itself as its own fallback when both picks are the same model', () => {
    const same = { strong: 'only-model', cheap: 'only-model' };
    const matrix = buildPresetMatrix(PRESET_SHAPES['all-local'], same);
    expect(matrix[ROLE_CODING_AGENT]?.default.fallbackChain).toEqual([]);
  });
});

describe('FR-G2 default config test: reviewer model differs from maker for every role pair', () => {
  it.each(Object.keys(PRESET_SHAPES) as PresetName[])(
    '%s: code-reviewer and challenger never resolve to the coding-agent model, for every task type',
    (name) => {
      const matrix: ScopedRoleMatrix = presetAsGlobalScope(name, PICKS);
      for (const taskType of TASK_TYPES) {
        const maker = resolveModelChain(matrix, ROLE_CODING_AGENT, taskType);
        for (const verifierRole of [ROLE_CODE_REVIEWER, ROLE_CHALLENGER]) {
          const verifier = resolveModelChain(matrix, verifierRole, taskType);
          expect(
            verifier.chain[0],
            `${name}/${taskType}: ${verifierRole} resolved to the same model as coding-agent`,
          ).not.toBe(maker.chain[0]);
        }
      }
    },
  );
});
