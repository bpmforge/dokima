import { describe, expect, it } from 'vitest';
import {
  RoutingUnresolvedError,
  resolveModelChain,
  resolveRoleRouting,
  resolveScopedValue,
} from './matrix.js';
import type { RoleRouting, ScopedRoleMatrix } from './types.js';

describe('resolveScopedValue', () => {
  it('picks run over project over global for the same role (FR-S1)', () => {
    const scopes = {
      global: { reviewer: 1 },
      project: { reviewer: 2 },
      run: { reviewer: 3 },
    };
    expect(resolveScopedValue(scopes, 'reviewer')).toEqual({ value: 3, scope: 'run' });
  });

  it('falls through to the next scope when a higher scope does not define the role', () => {
    const scopes = { global: { reviewer: 1 }, project: {}, run: {} };
    expect(resolveScopedValue(scopes, 'reviewer')).toEqual({ value: 1, scope: 'global' });
  });

  it('returns undefined when no scope defines the role', () => {
    expect(
      resolveScopedValue({ global: {}, project: {}, run: {} }, 'missing'),
    ).toBeUndefined();
  });

  it('treats an absent scope object the same as an empty scope', () => {
    expect(resolveScopedValue({ global: { reviewer: 1 } }, 'reviewer')).toEqual({
      value: 1,
      scope: 'global',
    });
  });

  it('does not deep-merge across scopes — the whole value comes from one scope', () => {
    const scopes: ScopedRoleMatrix = {
      global: { reviewer: { default: { model: 'a', fallbackChain: ['b'] } } },
      project: { reviewer: { default: { model: 'c', fallbackChain: [] } } },
    };
    // project wins wholesale; global's fallbackChain is NOT merged in.
    expect(resolveScopedValue(scopes, 'reviewer')).toEqual({
      value: { default: { model: 'c', fallbackChain: [] } },
      scope: 'project',
    });
  });
});

describe('resolveRoleRouting', () => {
  const codingAgent: RoleRouting = { default: { model: 'coder-a', fallbackChain: [] } };
  const fallback: RoleRouting = { default: { model: 'cheapest', fallbackChain: [] } };

  it('resolves the role directly when a scope defines it', () => {
    const matrix: ScopedRoleMatrix = { global: { 'coding-agent': codingAgent } };
    expect(resolveRoleRouting(matrix, 'coding-agent')).toEqual({
      value: codingAgent,
      scope: 'global',
      usedDefaultRole: false,
    });
  });

  it("falls back to the 'default' role when the requested role has no entry in any scope", () => {
    const matrix: ScopedRoleMatrix = { global: { default: fallback } };
    expect(resolveRoleRouting(matrix, 'unknown-role')).toEqual({
      value: fallback,
      scope: 'global',
      usedDefaultRole: true,
    });
  });

  it("returns undefined when neither the role nor 'default' is defined anywhere", () => {
    expect(resolveRoleRouting({}, 'unknown-role')).toBeUndefined();
  });

  it("returns undefined when asking for 'default' itself and it is unset", () => {
    expect(resolveRoleRouting({}, 'default')).toBeUndefined();
  });
});

describe('resolveModelChain (FR-G2: matrix resolves every (role, task-type) to a model or fallback)', () => {
  it('uses the role default assignment when no task-type override exists', () => {
    const matrix: ScopedRoleMatrix = {
      global: {
        'coding-agent': { default: { model: 'coder-a', fallbackChain: ['coder-b'] } },
      },
    };
    const result = resolveModelChain(matrix, 'coding-agent', 'code');
    expect(result).toEqual({
      role: 'coding-agent',
      taskType: 'code',
      chain: ['coder-a', 'coder-b'],
      scope: 'global',
      usedDefaultRole: false,
    });
  });

  it('prefers a task-type-specific assignment over the role default', () => {
    const matrix: ScopedRoleMatrix = {
      global: {
        'pm-interviewer': {
          default: { model: 'reasoning-model', fallbackChain: [] },
          taskTypes: {
            embed: { model: 'embed-model', fallbackChain: ['embed-fallback'] },
          },
        },
      },
    };
    expect(resolveModelChain(matrix, 'pm-interviewer', 'embed').chain).toEqual([
      'embed-model',
      'embed-fallback',
    ]);
    expect(resolveModelChain(matrix, 'pm-interviewer', 'reasoning').chain).toEqual([
      'reasoning-model',
    ]);
  });

  it('throws RoutingUnresolvedError when nothing resolves', () => {
    expect(() => resolveModelChain({}, 'ghost-role', 'code')).toThrow(
      RoutingUnresolvedError,
    );
  });

  it('reports the winning scope so the UI can answer "why is this role on this model" (FR-S1)', () => {
    const matrix: ScopedRoleMatrix = {
      global: {
        'coding-agent': { default: { model: 'global-model', fallbackChain: [] } },
      },
      project: {
        'coding-agent': { default: { model: 'project-model', fallbackChain: [] } },
      },
    };
    expect(resolveModelChain(matrix, 'coding-agent', 'code').scope).toBe('project');
  });
});
