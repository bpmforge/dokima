import { describe, expect, it } from 'vitest';
import {
  availableVerbsFrom,
  BOARD_COLUMNS,
  verbForDrop,
  verbTargetColumn,
} from './transitions.js';

describe('verbForDrop', () => {
  it('fires claim on ready -> claimed', () => {
    expect(verbForDrop('ready', 'claimed')).toBe('claim');
  });

  it('fires start on claimed -> in_progress', () => {
    expect(verbForDrop('claimed', 'in_progress')).toBe('start');
  });

  it('fires close on in_progress -> in_review', () => {
    expect(verbForDrop('in_progress', 'in_review')).toBe('close');
  });

  it('fires accept on in_review -> done', () => {
    expect(verbForDrop('in_review', 'done')).toBe('accept');
  });

  it('fires release from any owned state back to ready', () => {
    expect(verbForDrop('claimed', 'ready')).toBe('release');
    expect(verbForDrop('in_progress', 'ready')).toBe('release');
    expect(verbForDrop('in_review', 'ready')).toBe('release');
  });

  it('refuses drops that skip the lifecycle graph (same invariants as an agent, FR-T4)', () => {
    expect(verbForDrop('ready', 'in_progress')).toBeNull();
    expect(verbForDrop('ready', 'done')).toBeNull();
    expect(verbForDrop('claimed', 'done')).toBeNull();
    expect(verbForDrop('done', 'ready')).toBeNull();
  });

  it('refuses drops onto blocked/done — those are reflow/verb-terminal, not drag targets', () => {
    expect(verbForDrop('ready', 'blocked')).toBeNull();
    expect(verbForDrop('blocked', 'ready')).toBeNull();
  });

  it('refuses a no-op drop onto the same column', () => {
    expect(verbForDrop('ready', 'ready')).toBeNull();
  });

  it('exposes the six-column display order from UX_SPEC §4', () => {
    expect(BOARD_COLUMNS).toEqual([
      'ready',
      'claimed',
      'in_progress',
      'in_review',
      'blocked',
      'done',
    ]);
  });
});

describe('availableVerbsFrom', () => {
  it('lists the keyboard/menu equivalents of every drag from a status (WCAG 2.2 AA)', () => {
    expect(availableVerbsFrom('ready')).toEqual(['claim']);
    expect(availableVerbsFrom('claimed')).toEqual(['start', 'release']);
    expect(availableVerbsFrom('in_progress')).toEqual(['close', 'release']);
    expect(availableVerbsFrom('in_review')).toEqual(['accept', 'release']);
    expect(availableVerbsFrom('done')).toEqual([]);
    expect(availableVerbsFrom('blocked')).toEqual([]);
  });
});

describe('verbTargetColumn', () => {
  it('is the inverse of verbForDrop', () => {
    expect(verbTargetColumn('claim')).toBe('claimed');
    expect(verbTargetColumn('release')).toBe('ready');
  });
});
