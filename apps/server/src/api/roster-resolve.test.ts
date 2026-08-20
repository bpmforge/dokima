import { describe, expect, it } from 'vitest';
import type { ScopedSettings } from '@dokima/shared';
import {
  resolveEffectiveModel,
  resolveEffectiveModelFromSources,
} from './roster-resolve.js';

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

describe('resolveEffectiveModelFromSources (W13-57)', () => {
  const row = (role: string, taskType: string, model: string, fallback: string[] = []) => ({
    role,
    taskType,
    model,
    fallback,
  });
  const NO_SETTINGS = { global: {} };

  it('RED FIXTURE: the wizard walkthrough case — a role with no row of its own resolves through the default row', () => {
    // The store rows the setup wizard actually writes (W13-37): six roles,
    // task type 'code'. An expert like anti-slop-auditor has no row of its
    // own — and the shipped roster claimed "needs a model" for it on a fully
    // configured install, because it read a settings key nothing writes.
    const rows = [
      row('coding-agent', 'code', 'qwen/qwen3-coder-next', ['qwen3.6-35b-a3b']),
      row('default', 'code', 'qwen/qwen3-coder-next', ['qwen3.6-35b-a3b']),
    ];
    const result = resolveEffectiveModelFromSources(NO_SETTINGS, rows, [], 'anti-slop-auditor');
    expect(result.chain).toEqual(['qwen/qwen3-coder-next', 'qwen3.6-35b-a3b']);
    expect(result.usedDefaultRole).toBe(true);
    expect(result.scope).toBe('global');
  });

  it('a role with its own row uses it, and scope says where the row lives', () => {
    const rows = [row('coding-agent', 'code', 'project-model')];
    const result = resolveEffectiveModelFromSources(NO_SETTINGS, rows, rows, 'coding-agent');
    expect(result.chain).toEqual(['project-model']);
    expect(result.usedDefaultRole).toBe(false);
    expect(result.scope).toBe('project');
  });

  it('the settings envelope stays the higher-precedence override it was designed to be', () => {
    const settings = {
      global: {
        'roleMatrix.coding-agent': { default: { model: 'pinned-override', fallbackChain: [] } },
      },
    } as never;
    const rows = [row('coding-agent', 'code', 'store-model')];
    const result = resolveEffectiveModelFromSources(settings, rows, [], 'coding-agent');
    expect(result.chain).toEqual(['pinned-override']);
  });

  it('no rows anywhere still resolves honestly to unconfigured — never a fabricated chain (C-1)', () => {
    const result = resolveEffectiveModelFromSources(NO_SETTINGS, [], [], 'coding-agent');
    expect(result.chain).toEqual([]);
    expect(result.scope).toBeNull();
  });
});
