import { describe, expect, it } from 'vitest';
import {
  clampPaneSize,
  defaultLayout,
  deserializePaneLayout,
  paneLayoutStorageKey,
  serializePaneLayout,
  focusPane,
  unfocusPanes,
  isFocused,
  type PaneLayout,
  MIN_PANE_PCT,
  MAX_PANE_PCT,
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

describe('default pane allocation (W12-30)', () => {
  it(
    'RED FIXTURE: the board gets the largest share. It was an even 34/33/33, so ' +
      'the pane this same function marks as activeView received the smallest-equal ' +
      'share — ~470px at 1440px, where six lifecycle states cannot fit and the ' +
      'grid correctly wrapped them 3x2',
    () => {
      const layout = defaultLayout();
      expect(layout.activeView).toBe('board');
      expect(layout.panes.board.sizePct).toBeGreaterThan(layout.panes.chat.sizePct);
      expect(layout.panes.board.sizePct).toBeGreaterThan(layout.panes.artifacts.sizePct);
    },
  );

  it('still sums to 100 and every pane stays inside the draggable range', () => {
    const layout = defaultLayout();
    const total =
      layout.panes.chat.sizePct + layout.panes.board.sizePct + layout.panes.artifacts.sizePct;
    expect(total).toBe(100);
    for (const pane of Object.values(layout.panes)) {
      expect(pane.sizePct).toBeGreaterThanOrEqual(MIN_PANE_PCT);
      expect(pane.sizePct).toBeLessThanOrEqual(MAX_PANE_PCT);
    }
  });

  it('changes a DEFAULT, not a constraint — an even split is still reachable by dragging', () => {
    expect(clampPaneSize(33)).toBe(33);
    expect(clampPaneSize(34)).toBe(34);
  });
});

describe('focus mode (W12-34)', () => {
  it(
    'RED FIXTURE: focusing the board collapses the other panes so the full ' +
      'lifecycle fits. W12-30 got 5 of 6 states on one row and stopped there, ' +
      'because the sixth needed either a measured constant shrunk on a hunch or ' +
      'a board wide enough to starve Chat',
    () => {
      const focused = focusPane(defaultLayout(), 'board');
      expect(focused.panes.board.collapsed).toBe(false);
      expect(focused.panes.chat.collapsed).toBe(true);
      expect(focused.panes.artifacts.collapsed).toBe(true);
      expect(focused.activeView).toBe('board');
    },
  );

  it('RESTORES the layout the user had, not the default', () => {
    const dragged: PaneLayout = {
      panes: {
        chat: { sizePct: 50, collapsed: false },
        board: { sizePct: 30, collapsed: false },
        artifacts: { sizePct: 20, collapsed: false },
      },
      activeView: 'chat',
    };
    const restored = unfocusPanes(focusPane(dragged, 'board'));
    expect(restored.panes).toEqual(dragged.panes);
    expect(restored.panes.chat.sizePct).toBe(50);
  });

  it(
    'focusing twice does not overwrite the saved layout with the focused one — ' +
      'that is how a restore silently becomes a no-op',
    () => {
      const start = defaultLayout();
      const twice = focusPane(focusPane(start, 'board'), 'board');
      expect(unfocusPanes(twice).panes).toEqual(start.panes);
    },
  );

  it('leaving focus without ever entering it expands everything rather than stranding a user', () => {
    const stuck: PaneLayout = {
      panes: {
        chat: { sizePct: 34, collapsed: true },
        board: { sizePct: 33, collapsed: true },
        artifacts: { sizePct: 33, collapsed: true },
      },
      activeView: 'board',
    };
    const out = unfocusPanes(stuck);
    expect(Object.values(out.panes).every((p) => !p.collapsed)).toBe(true);
  });

  it('isFocused toggles, so the affordance does not stack', () => {
    const start = defaultLayout();
    expect(isFocused(start)).toBe(false);
    expect(isFocused(focusPane(start, 'board'))).toBe(true);
    expect(isFocused(unfocusPanes(focusPane(start, 'board')))).toBe(false);
  });
});
