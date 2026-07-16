import { describe, expect, it } from 'vitest';
import type { ScopedSettings } from '@shipwright/shared';
import { resolveEffectiveModel } from './roster-resolve.js';

describe('resolveEffectiveModel', () => {
  it('reports unconfigured (scope: null) when no scope defines the role or default (C-1 honesty)', () => {
    const result = resolveEffectiveModel({}, 'sdlc-lead');
    expect(result).toEqual({
      role: 'sdlc-lead',
      chain: [],
      scope: null,
      usedDefaultRole: false,
    });
  });

  it('resolves a role directly defined at global scope (RoleRouting-shaped: {default: {model, fallbackChain}})', () => {
    const settings: ScopedSettings = {
      global: {
        'roleMatrix.sdlc-lead': {
          default: { model: 'qwen2.5-coder-32b-instruct', fallbackChain: [] },
        },
      },
    };
    expect(resolveEffectiveModel(settings, 'sdlc-lead')).toEqual({
      role: 'sdlc-lead',
      chain: ['qwen2.5-coder-32b-instruct'],
      scope: 'global',
      usedDefaultRole: false,
    });
  });

  it('project scope wins over global for the same role (FR-S1: run > project > global)', () => {
    const settings: ScopedSettings = {
      global: {
        'roleMatrix.sdlc-lead': { default: { model: 'global-model', fallbackChain: [] } },
      },
      project: {
        'roleMatrix.sdlc-lead': {
          default: { model: 'project-model', fallbackChain: ['fallback-a'] },
        },
      },
    };
    expect(resolveEffectiveModel(settings, 'sdlc-lead')).toEqual({
      role: 'sdlc-lead',
      chain: ['project-model', 'fallback-a'],
      scope: 'project',
      usedDefaultRole: false,
    });
  });

  it('does not deep-merge across scopes — the whole assignment comes from one scope', () => {
    const settings: ScopedSettings = {
      global: {
        'roleMatrix.sdlc-lead': {
          default: { model: 'global-model', fallbackChain: ['g-fallback'] },
        },
      },
      project: {
        'roleMatrix.sdlc-lead': {
          default: { model: 'project-model', fallbackChain: [] },
        },
      },
    };
    expect(resolveEffectiveModel(settings, 'sdlc-lead').chain).toEqual(['project-model']);
  });

  it("falls back to the 'default' role when the expert has no entry of its own", () => {
    const settings: ScopedSettings = {
      global: {
        'roleMatrix.default': {
          default: { model: 'cheapest-capable', fallbackChain: [] },
        },
      },
    };
    expect(resolveEffectiveModel(settings, 'unlisted-expert')).toEqual({
      role: 'unlisted-expert',
      chain: ['cheapest-capable'],
      scope: 'global',
      usedDefaultRole: true,
    });
  });

  it('a malformed matrix entry (no .default.model) resolves as unconfigured rather than throwing', () => {
    const settings: ScopedSettings = {
      global: { 'roleMatrix.sdlc-lead': { default: { fallbackChain: ['x'] } } },
    };
    expect(resolveEffectiveModel(settings, 'sdlc-lead').scope).toBeNull();
  });

  it('a legacy flat {model, fallbackChain} value (no .default envelope) resolves as unconfigured, not a crash', () => {
    const settings: ScopedSettings = {
      global: { 'roleMatrix.sdlc-lead': { model: 'flat-model', fallbackChain: [] } },
    };
    expect(resolveEffectiveModel(settings, 'sdlc-lead').scope).toBeNull();
  });
});
