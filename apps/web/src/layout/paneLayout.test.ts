import { describe, expect, it } from 'vitest';
import {
  clampPaneSize,
  defaultLayout,
  deserializePaneLayout,
  paneLayoutStorageKey,
  serializePaneLayout,
} from './paneLayout.js';

describe('clampPaneSize', () => {
  it('clamps below the minimum', () => {
    expect(clampPaneSize(2)).toBe(15);
  });

  it('clamps above the maximum', () => {
    expect(clampPaneSize(95)).toBe(70);
  });

  it('leaves in-range values untouched', () => {
    expect(clampPaneSize(40)).toBe(40);
  });
});

describe('paneLayoutStorageKey', () => {
  it('namespaces the key per project id', () => {
    expect(paneLayoutStorageKey('proj-a')).toBe('dokima.paneLayout.proj-a');
    expect(paneLayoutStorageKey('proj-b')).toBe('dokima.paneLayout.proj-b');
  });
});

describe('serializePaneLayout / deserializePaneLayout', () => {
  it('round-trips a valid layout', () => {
    const layout = defaultLayout();
    expect(deserializePaneLayout(serializePaneLayout(layout))).toEqual(layout);
  });

  it('returns undefined for missing data', () => {
    expect(deserializePaneLayout(null)).toBeUndefined();
  });

  it('returns undefined for malformed JSON', () => {
    expect(deserializePaneLayout('not json')).toBeUndefined();
  });

  it('returns undefined for JSON missing required pane fields', () => {
    expect(
      deserializePaneLayout(JSON.stringify({ activeView: 'board' })),
    ).toBeUndefined();
    expect(
      deserializePaneLayout(JSON.stringify({ activeView: 'nope', panes: {} })),
    ).toBeUndefined();
  });
});
