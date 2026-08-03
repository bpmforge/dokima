import { useEffect, useState } from 'react';

/**
 * `SplitPaneWorkspace` (W4-01) has no content-slot prop for its panes, and
 * `apps/web/src/layout/**` sits outside the write_scope of the tickets that
 * have needed it — this repo's own history (W4-01's gate-fix, docs/STATUS.md)
 * establishes that self-authorizing an out-of-scope edit is the wrong move;
 * the fix is to stop touching that file, not widen scope. A portal into its
 * already-rendered `pane-*` DOM node mounts each workspace from files those
 * tickets *can* write.
 *
 * W10-61: these used to re-query keyed on `projectId` alone, and that is a
 * subtly wrong dependency. `MainView` early-returns a full-screen component
 * for every non-canvas view, so opening Describe (or Roster, Plan,
 * Notifications, Trace) UNMOUNTS `SplitPaneWorkspace` and destroys its pane
 * nodes; coming back mounts a fresh one with NEW nodes while `projectId` never
 * changed. The effect therefore never re-ran and every hook kept handing
 * `createPortal` a stale, detached element — so all three panes rendered
 * empty until a page reload reset the state.
 *
 * That was measured, not theorised: the giveaway is that CHAT and ARTIFACTS
 * went blank too. A data-timing, WebSocket or missing-event explanation can
 * only account for an empty board.
 *
 * The dependency that is actually correct is "the DOM changed", which React
 * cannot express as a dep array — so the effect runs after every render and
 * the setter no-ops unless the node genuinely differs. Three `querySelector`
 * calls per render is nothing next to a portal into a detached node, and this
 * removes the whole class of bug rather than the one path that exposed it.
 */
function usePaneNode(testId: string): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const current = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    // Referential compare, deliberately: an identical-but-different element
    // (a remount) MUST replace the old one, and an unchanged one must not
    // schedule a re-render — that is what keeps a dep-less effect stable.
    setNode((previous) => (previous === current ? previous : current));
  });
  return node;
}

export function useChatPaneNode(): HTMLElement | null {
  return usePaneNode('pane-chat');
}

/** Same portal pattern as `useChatPaneNode`, targeting the board pane (UX_SPEC §2a). */
export function useBoardPaneNode(): HTMLElement | null {
  return usePaneNode('pane-board');
}

/**
 * Same portal pattern as `useChatPaneNode`, targeting the artifacts pane —
 * its actual, spec'd home (UX_SPEC §5: "Artifact Viewer + Receipt
 * Inspector (right pane)"). `EstimateWorkspace` (W4-08) portaled into this
 * same node as a stopgap because its real home, the Settings Matrix
 * (UX_SPEC §6), didn't exist yet.
 */
export function useArtifactsPaneNode(): HTMLElement | null {
  return usePaneNode('pane-artifacts');
}
