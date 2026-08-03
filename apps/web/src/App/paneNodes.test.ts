// @vitest-environment jsdom
/**
 * W10-61. The defect these guard against was measured in a browser: after a
 * successful board build the Canvas rendered Chat, Board and Artifacts as
 * three EMPTY panes, and a manual page reload showed all nine tickets.
 *
 * The cause was the dependency, not the data. `MainView` early-returns a
 * full-screen component for every non-canvas view, so opening Describe
 * unmounts `SplitPaneWorkspace` and destroys its pane nodes; coming back
 * mounts a fresh one with NEW nodes while `projectId` never changed. Keyed on
 * `projectId`, the effect never re-ran and `createPortal` kept receiving a
 * stale, detached element.
 *
 * The first case below fails against that implementation and is the reason
 * this file exists. The second pins the property that makes a dep-less effect
 * safe — no re-render when nothing moved.
 */

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useBoardPaneNode, useChatPaneNode } from './paneNodes.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function mountPane(testId: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-testid', testId);
  document.body.appendChild(el);
  return el;
}

describe('pane node hooks survive a remount (W10-61)', () => {
  it('picks up a REPLACED pane node — the stale-portal-target defect', () => {
    const first = mountPane('pane-board');
    const { result, rerender } = renderHook(() => useBoardPaneNode());
    expect(result.current).toBe(first);

    // Exactly what MainView does: swap to a full-screen view (pane nodes
    // destroyed) and back (fresh ones created). projectId never changes.
    first.remove();
    const second = mountPane('pane-board');
    rerender();

    expect(result.current).toBe(second);
    expect(result.current).not.toBe(first);
    expect(document.body.contains(result.current)).toBe(true);
  });

  it('returns null while the pane is absent, rather than a detached node', () => {
    const only = mountPane('pane-chat');
    const { result, rerender } = renderHook(() => useChatPaneNode());
    expect(result.current).toBe(only);

    only.remove();
    rerender();

    expect(result.current).toBeNull();
  });

  it('finds a pane that only appears AFTER first render (Fleet -> Open, no reload)', () => {
    const { result, rerender } = renderHook(() => useBoardPaneNode());
    expect(result.current).toBeNull();

    const late = mountPane('pane-board');
    rerender();

    expect(result.current).toBe(late);
  });

  it('holds the same reference across re-renders when nothing moved', () => {
    const el = mountPane('pane-board');
    const { result, rerender } = renderHook(() => useBoardPaneNode());
    const first = result.current;

    rerender();
    rerender();

    // A dep-less effect that set state unconditionally would loop forever;
    // this is the property that makes it safe.
    expect(result.current).toBe(first);
    expect(result.current).toBe(el);
  });

  it('keeps the panes independent — one remounting does not disturb another', () => {
    const board = mountPane('pane-board');
    const chat = mountPane('pane-chat');
    const { result, rerender } = renderHook(() => ({
      board: useBoardPaneNode(),
      chat: useChatPaneNode(),
    }));
    expect(result.current.board).toBe(board);
    expect(result.current.chat).toBe(chat);

    board.remove();
    const newBoard = mountPane('pane-board');
    rerender();

    expect(result.current.board).toBe(newBoard);
    expect(result.current.chat).toBe(chat);
  });
});
