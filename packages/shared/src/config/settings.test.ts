import { describe, expect, it } from 'vitest';
import {
  isJsonValue,
  isSettingsMap,
  resolveEffectiveSettings,
  resolveEffectiveValue,
  type ScopedSettings,
} from './settings.js';

describe('resolveEffectiveValue', () => {
  it('picks run over project over global for the same key (FR-S1)', () => {
    const settings: ScopedSettings = {
      global: { berths: 1 },
      project: { berths: 2 },
      run: { berths: 3 },
    };
    expect(resolveEffectiveValue('berths', settings)).toEqual({ value: 3, scope: 'run' });
  });

  it('falls through to the next scope when a higher scope does not define the key', () => {
    const settings: ScopedSettings = {
      global: { berths: 1 },
      project: {},
      run: {},
    };
    expect(resolveEffectiveValue('berths', settings)).toEqual({
      value: 1,
      scope: 'global',
    });
  });

  it('returns undefined when no scope defines the key', () => {
    expect(
      resolveEffectiveValue('missing', { global: {}, project: {}, run: {} }),
    ).toBeUndefined();
  });

  it('does not deep-merge nested objects across scopes — the whole value comes from one scope', () => {
    const settings: ScopedSettings = {
      global: { notifications: { enabled: true, quietHours: '22:00-08:00' } },
      project: { notifications: { enabled: false } },
    };
    // project wins wholesale; global's quietHours is NOT merged in.
    expect(resolveEffectiveValue('notifications', settings)).toEqual({
      value: { enabled: false },
      scope: 'project',
    });
  });

  it('a key explicitly set to null in a higher scope wins over a lower scope value', () => {
    const settings: ScopedSettings = {
      global: { autonomyDial: 'auto' },
      project: { autonomyDial: null },
    };
    expect(resolveEffectiveValue('autonomyDial', settings)).toEqual({
      value: null,
      scope: 'project',
    });
  });

  it('an absent scope object is treated the same as an empty scope', () => {
    expect(resolveEffectiveValue('berths', { global: { berths: 1 } })).toEqual({
      value: 1,
      scope: 'global',
    });
  });
});

describe('resolveEffectiveSettings', () => {
  it('resolves the union of keys across all three scopes, each independently', () => {
    const settings: ScopedSettings = {
      global: { a: 1, b: 1 },
      project: { b: 2, c: 2 },
      run: { c: 3 },
    };
    const resolved = resolveEffectiveSettings(settings);
    expect(resolved.get('a')).toEqual({ value: 1, scope: 'global' });
    expect(resolved.get('b')).toEqual({ value: 2, scope: 'project' });
    expect(resolved.get('c')).toEqual({ value: 3, scope: 'run' });
    expect(resolved.size).toBe(3);
  });

  it('returns an empty map for all-empty scopes', () => {
    expect(resolveEffectiveSettings({}).size).toBe(0);
  });
});

describe('isJsonValue', () => {
  it.each([null, 'x', 1, true, [1, 'a', null], { a: 1, b: { c: [true] } }])(
    'accepts %j',
    (value) => {
      expect(isJsonValue(value)).toBe(true);
    },
  );

  it.each([undefined, () => {}, new Map(), Symbol('x')])('rejects %j', (value) => {
    expect(isJsonValue(value)).toBe(false);
  });
});

describe('isSettingsMap', () => {
  it('accepts a flat JSON object', () => {
    expect(isSettingsMap({ a: 1, b: 'two', c: { nested: true } })).toBe(true);
  });

  it('rejects arrays, null, and objects containing non-JSON values', () => {
    expect(isSettingsMap([1, 2])).toBe(false);
    expect(isSettingsMap(null)).toBe(false);
    expect(isSettingsMap({ a: undefined })).toBe(false);
  });
});
