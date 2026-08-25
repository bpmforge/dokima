/**
 * W20-06 (D-029/D-030): every member carries their own escalation policy, and
 * `ask` defers the climb rather than blocking the attempt in flight.
 */
import { describe, expect, it } from 'vitest';
import { resolvePolicyScope } from './run-build-policy.js';
import { isAskMode, resolvePerRolePolicyScope } from './run-build-policy-members.js';

describe('per-member escalation policy and ask mode (W20-06, D-029)', () => {
  it('RED FIXTURE: ask mode NEVER climbs unattended — the attempt keeps running on its current rung, so an overnight run cannot hang mid-ladder', () => {
    const out = resolvePolicyScope({ mode: 'ask', providerKind: 'lm-studio' }, 'coding-agent');
    expect('scope' in out).toBe(true);
    const policy = (out as { scope: Record<string, Record<string, { mode: string }>> })
      .scope.global!['coding-agent']!;
    // `locked` is exactly "retry this rung under the ceiling, then park".
    expect(policy.mode).toBe('locked');
  });

  it('each member can carry their own policy — resolution is per role, not maker-only', () => {
    const out = resolvePerRolePolicyScope(
      {
        roles: {
          'coding-agent': { mode: 'ask', providerKind: 'lm-studio' },
          challenger: { mode: 'token-gated', namedTier: 'R2' },
        },
      },
      ['coding-agent', 'challenger'],
    );
    const scope = (out as { scope: { global: Record<string, { mode: string }> } }).scope;
    expect(scope.global['coding-agent']!.mode).toBe('locked'); // ask -> never climbs
    expect(scope.global['challenger']!.mode).toBe('token-gated');
  });

  it('the legacy flat shape still means what it always meant — an existing install does not change behaviour', () => {
    const flat = resolvePerRolePolicyScope({ mode: 'token-gated', namedTier: 'R3' }, [
      'coding-agent',
    ]);
    const scope = (flat as { scope: { global: Record<string, { mode: string }> } }).scope;
    expect(scope.global['coding-agent']!.mode).toBe('token-gated');
  });

  it('isAskMode reads per-role and flat shapes, and is false for every other mode', () => {
    expect(isAskMode({ roles: { challenger: { mode: 'ask' } } }, 'challenger')).toBe(true);
    expect(isAskMode({ roles: { challenger: { mode: 'ask' } } }, 'coding-agent')).toBe(false);
    expect(isAskMode({ mode: 'ask' }, 'coding-agent')).toBe(true);
    expect(isAskMode({ mode: 'ladder' }, 'coding-agent')).toBe(false);
    expect(isAskMode(undefined, 'coding-agent')).toBe(false);
  });

  it('a refusal inside one member does not silently drop the others — it refuses the whole resolution', () => {
    const out = resolvePerRolePolicyScope(
      { roles: { 'coding-agent': { mode: 'pinned' } } },
      ['coding-agent'],
    );
    expect('refusal' in out).toBe(true);
  });
});
