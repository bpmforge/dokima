/**
 * The three shipped matrix presets (FR-S3, BLUEPRINT §3.1.4/§3.3):
 * All-local, Hybrid (local maker + frontier review), All-cloud. Each is a
 * complete RoleMatrix meant to seed the global scope — project/run scopes
 * layer overrides on top per FR-S1. By construction, every preset's
 * reviewer/challenger primary model differs from the coding-agent's
 * (FR-G2 default; see presets.test.ts's exhaustive check of this
 * property).
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

function assignment(
  model: string,
  fallbackChain: readonly string[] = [],
): ModelAssignment {
  return { model, fallbackChain };
}

export const PRESET_ALL_LOCAL: RoleMatrix = {
  [ROLE_CODING_AGENT]: {
    default: assignment('qwen2.5-coder-7b-instruct', ['qwen2.5-coder-32b-instruct']),
  },
  [ROLE_CODE_REVIEWER]: {
    default: assignment('qwen2.5-coder-32b-instruct', ['qwen2.5-coder-7b-instruct']),
  },
  [ROLE_CHALLENGER]: {
    default: assignment('qwen2.5-coder-32b-instruct', ['qwen2.5-coder-7b-instruct']),
  },
  [ROLE_TEST_ENGINEER]: {
    default: assignment('qwen2.5-coder-7b-instruct'),
  },
  [ROLE_PM_INTERVIEWER]: {
    default: assignment('qwen2.5-coder-32b-instruct'),
  },
  [DEFAULT_ROLE]: {
    default: assignment('qwen2.5-coder-7b-instruct'),
  },
};

export const PRESET_HYBRID: RoleMatrix = {
  [ROLE_CODING_AGENT]: {
    default: assignment('qwen2.5-coder-7b-instruct', ['qwen2.5-coder-32b-instruct']),
  },
  [ROLE_CODE_REVIEWER]: {
    default: assignment('claude-opus-4-8', ['claude-sonnet-5']),
  },
  [ROLE_CHALLENGER]: {
    default: assignment('claude-opus-4-8', ['gpt-5.1']),
  },
  [ROLE_TEST_ENGINEER]: {
    default: assignment('qwen2.5-coder-7b-instruct'),
  },
  [ROLE_PM_INTERVIEWER]: {
    default: assignment('claude-sonnet-5', ['qwen2.5-coder-32b-instruct']),
  },
  [DEFAULT_ROLE]: {
    default: assignment('qwen2.5-coder-7b-instruct', ['claude-sonnet-5']),
  },
};

export const PRESET_ALL_CLOUD: RoleMatrix = {
  [ROLE_CODING_AGENT]: {
    default: assignment('claude-sonnet-5', ['gpt-5.1']),
  },
  [ROLE_CODE_REVIEWER]: {
    default: assignment('claude-opus-4-8', ['gpt-5.1']),
  },
  [ROLE_CHALLENGER]: {
    default: assignment('claude-opus-4-8', ['gemini-2.5-pro']),
  },
  [ROLE_TEST_ENGINEER]: {
    default: assignment('claude-sonnet-5', ['gpt-5.1']),
  },
  [ROLE_PM_INTERVIEWER]: {
    default: assignment('claude-sonnet-5'),
  },
  [DEFAULT_ROLE]: {
    default: assignment('claude-sonnet-5', ['gpt-5.1']),
    taskTypes: {
      embed: assignment('text-embedding-3-large'),
      escalation: assignment('claude-opus-4-8'),
    },
  },
};

export type PresetName = 'all-local' | 'hybrid' | 'all-cloud';

export const PRESETS: Record<PresetName, RoleMatrix> = {
  'all-local': PRESET_ALL_LOCAL,
  hybrid: PRESET_HYBRID,
  'all-cloud': PRESET_ALL_CLOUD,
};

/** The canonical roles every shipped preset must define (used by presets.test.ts's coverage check). */
export const PRESET_ROLES: readonly AgentRole[] = [
  ROLE_CODING_AGENT,
  ROLE_CODE_REVIEWER,
  ROLE_CHALLENGER,
  ROLE_TEST_ENGINEER,
  ROLE_PM_INTERVIEWER,
  DEFAULT_ROLE,
];

/** Wraps a preset as a global-scope matrix — the typical starting point before project/run overrides layer on top (FR-S1/S3). */
export function presetAsGlobalScope(name: PresetName): { global: RoleMatrix } {
  return { global: PRESETS[name] };
}
