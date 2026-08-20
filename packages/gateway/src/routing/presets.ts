/**
 * Matrix presets: WHICH ROLE GETS THE BETTER MODEL — never which model.
 *
 * W13-36. These used to be complete `RoleMatrix` literals naming specific
 * models: `qwen2.5-coder-7b-instruct`, `claude-opus-4-8`, `gpt-5.1`. A
 * customer walkthrough on a clean install is what killed that design — the
 * machine it was run on had 26 models loaded in LM Studio and not one of those
 * names among them. Seeding a matrix from a guessed id produces "Invalid model
 * identifier" at the endpoint, which is a worse failure than having no matrix
 * at all because it looks like the product is configured.
 *
 * A preset is now a SHAPE: per role, whether it wants the stronger or the
 * cheaper of whatever the user actually has. The model ids come from the
 * user's own provider (`listModels()`), never from this file. Nothing here
 * names a model, and nothing here should ever name one again.
 *
 * THE ONE PROPERTY THAT SURVIVES INTACT: every preset gives the reviewer and
 * challenger a different tier from the coding agent, so a matrix built from
 * one satisfies maker != verifier (C-4 / FR-G2) by construction rather than by
 * luck — see presets.test.ts's exhaustive check.
 */

import type { AgentRole, ModelAssignment, RoleMatrix } from './types.js';
import {
  DEFAULT_ROLE,
  ROLE_CHALLENGER,
  ROLE_CODE_REVIEWER,
  ROLE_CODING_AGENT,
  ROLE_PM_INTERVIEWER,
  ROLE_TEST_ENGINEER,
} from './types.js';

/**
 * Which of the user's models a role should get. Deliberately two values and
 * not a number: a customer picks two models in setup, and a five-point scale
 * would be a scale nobody has the models to fill.
 */
export type ModelTier = 'strong' | 'cheap';

/** A preset with no model ids in it — roles mapped to tiers. */
export type PresetShape = Readonly<Record<AgentRole, ModelTier>>;

export type PresetName = 'all-local' | 'hybrid' | 'all-cloud';

/**
 * The shapes are IDENTICAL across the three names, and that is not an
 * oversight worth "fixing" by inventing differences: which roles deserve the
 * stronger model does not change because the model happens to run locally or
 * in a datacentre. What differs between local/hybrid/cloud is WHICH PROVIDER
 * the models come from, which is the user's provider registration — not this
 * table. The names are kept because they are what the wizard and
 * `defaultModelMatrixPreset` already speak.
 */
const REVIEW_HEAVY: PresetShape = {
  // The maker gets the cheaper model: it runs the most turns, and its work is
  // checked by something else. The checkers get the stronger one.
  [ROLE_CODING_AGENT]: 'cheap',
  [ROLE_CODE_REVIEWER]: 'strong',
  [ROLE_CHALLENGER]: 'strong',
  [ROLE_TEST_ENGINEER]: 'cheap',
  [ROLE_PM_INTERVIEWER]: 'strong',
  [DEFAULT_ROLE]: 'cheap',
};

export const PRESET_SHAPES: Readonly<Record<PresetName, PresetShape>> = {
  'all-local': REVIEW_HEAVY,
  hybrid: REVIEW_HEAVY,
  'all-cloud': REVIEW_HEAVY,
};

/** The typed name list — derived, never hand-listed a second time (W10-42). */
export const PRESET_NAMES: readonly PresetName[] = Object.keys(
  PRESET_SHAPES,
) as readonly PresetName[];

/** The canonical roles every shipped preset must define (presets.test.ts checks coverage). */
export const PRESET_ROLES: readonly AgentRole[] = [
  ROLE_CODING_AGENT,
  ROLE_CODE_REVIEWER,
  ROLE_CHALLENGER,
  ROLE_TEST_ENGINEER,
  ROLE_PM_INTERVIEWER,
  DEFAULT_ROLE,
];

/** The two models a preset needs, chosen by the user from their own provider. */
export interface TierPicks {
  readonly strong: string;
  readonly cheap: string;
}

function assignment(model: string, fallbackChain: readonly string[] = []): ModelAssignment {
  return { model, fallbackChain };
}

/**
 * Builds a real `RoleMatrix` from a preset shape and the user's own two
 * models.
 *
 * Each role falls back to the OTHER tier: on a machine with two usable models
 * that is the only honest fallback there is, and it keeps a role working when
 * one model is unloaded rather than failing the run.
 */
export function buildPresetMatrix(shape: PresetShape, picks: TierPicks): RoleMatrix {
  const matrix: Record<string, { default: ModelAssignment }> = {};
  for (const role of PRESET_ROLES) {
    const tier = shape[role] ?? 'cheap';
    const primary = tier === 'strong' ? picks.strong : picks.cheap;
    const other = tier === 'strong' ? picks.cheap : picks.strong;
    matrix[role] = {
      default: assignment(primary, primary === other ? [] : [other]),
    };
  }
  return matrix as RoleMatrix;
}

/** Wraps a built matrix as a global scope — the starting point project/run scopes override (FR-S1/S3). */
export function presetAsGlobalScope(
  name: PresetName,
  picks: TierPicks,
): { global: RoleMatrix } {
  return { global: buildPresetMatrix(PRESET_SHAPES[name], picks) };
}
