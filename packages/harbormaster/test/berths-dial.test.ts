import { describe, expect, it } from 'vitest';
import type { ScopedSettings } from '@shipwright/shared';
import {
  BERTHS_SETTINGS_KEY,
  DEFAULT_BERTHS,
  resolveAutorunBreakpoint,
  resolveBerthCount,
} from '../src/berths-dial.js';

describe('resolveBerthCount (D-010, FR-S1 three-scope precedence)', () => {
  it('defaults to 1 (strict sequential) with no settings at all', () => {
    expect(resolveBerthCount()).toBe(DEFAULT_BERTHS);
    expect(resolveBerthCount({ settings: {} })).toBe(1);
  });

  it('uses the global scope when nothing more specific defines it', () => {
    const settings: ScopedSettings = { global: { [BERTHS_SETTINGS_KEY]: 3 } };
    expect(resolveBerthCount({ settings })).toBe(3);
  });

  it('project overrides global', () => {
    const settings: ScopedSettings = {
      global: { [BERTHS_SETTINGS_KEY]: 3 },
      project: { [BERTHS_SETTINGS_KEY]: 5 },
    };
    expect(resolveBerthCount({ settings })).toBe(5);
  });

  it('run overrides project and global (the run-override case)', () => {
    const settings: ScopedSettings = {
      global: { [BERTHS_SETTINGS_KEY]: 3 },
      project: { [BERTHS_SETTINGS_KEY]: 5 },
      run: { [BERTHS_SETTINGS_KEY]: 2 },
    };
    expect(resolveBerthCount({ settings })).toBe(2);
  });

  it('clamps a non-positive or fractional dial value to a sane sequential floor', () => {
    expect(resolveBerthCount({ settings: { run: { berths: 0 } } })).toBe(1);
    expect(resolveBerthCount({ settings: { run: { berths: -4 } } })).toBe(1);
    expect(resolveBerthCount({ settings: { run: { berths: 3.7 } } })).toBe(3);
  });

  it('falls back to the default when the resolved value is not a number', () => {
    expect(resolveBerthCount({ settings: { run: { berths: 'lots' } } })).toBe(1);
  });
});

describe('resolveAutorunBreakpoint (BLUEPRINT §5 "one toggle + one slider")', () => {
  it('autorun forces breakpoint never regardless of an explicit breakpoint', () => {
    expect(
      resolveAutorunBreakpoint({ autorun: true, berths: 4, breakpoint: 'wave' }),
    ).toEqual({ breakpoint: 'never', berths: 4 });
  });

  it('autorun off keeps the explicit breakpoint', () => {
    expect(
      resolveAutorunBreakpoint({ autorun: false, berths: 1, breakpoint: 'wave' }),
    ).toEqual({ breakpoint: 'wave', berths: 1 });
  });

  it('autorun off with no explicit breakpoint defaults to the conservative ticket mode', () => {
    expect(resolveAutorunBreakpoint({ autorun: false, berths: 2 })).toEqual({
      breakpoint: 'ticket',
      berths: 2,
    });
  });

  it('berths=1 autorun is still valid (strict sequential autorun)', () => {
    expect(resolveAutorunBreakpoint({ autorun: true, berths: 1 })).toEqual({
      breakpoint: 'never',
      berths: 1,
    });
  });
});
