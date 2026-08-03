import { describe, expect, it } from 'vitest';
import { resolveModelChain } from './matrix.js';
import {
  PRESET_NAMES,
  PRESET_ROLES,
  PRESETS,
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

describe('FR-S3: presets All-local/Hybrid/All-cloud ship', () => {
  it('ships exactly the three named presets', () => {
    expect(Object.keys(PRESETS).sort()).toEqual(['all-cloud', 'all-local', 'hybrid']);
  });

  it.each(Object.keys(PRESETS) as PresetName[])(
    '%s defines every canonical role',
    (name) => {
      const preset = PRESETS[name];
      for (const role of PRESET_ROLES) {
        expect(preset[role], `${name} is missing role '${role}'`).toBeDefined();
      }
    },
  );

  it('presetAsGlobalScope wraps a preset as the global scope', () => {
    expect(presetAsGlobalScope('hybrid')).toEqual({ global: PRESETS.hybrid });
  });

  /** W10-42: pins the exact list apps/web/src/settings/types.ts hand-mirrors as MODEL_MATRIX_PRESETS. */
  it('PRESET_NAMES is Object.keys(PRESETS), typed', () => {
    expect(PRESET_NAMES).toEqual(['all-local', 'hybrid', 'all-cloud']);
  });
});

describe('FR-G2 default config test: reviewer model differs from maker for every role pair', () => {
  it.each(Object.keys(PRESETS) as PresetName[])(
    '%s: code-reviewer and challenger never resolve to the coding-agent model, for every task type',
    (name) => {
      const matrix: ScopedRoleMatrix = presetAsGlobalScope(name);
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
