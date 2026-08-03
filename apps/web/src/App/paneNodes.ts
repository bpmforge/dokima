import { useEffect, useState } from 'react';

/**
 * `SplitPaneWorkspace` (W4-01) has no content-slot prop for its panes, and
 * `apps/web/src/layout/**` sits outside this ticket's write_scope — this
 * repo's own history (W4-01's gate-fix, docs/STATUS.md) establishes that
 * self-authorizing an out-of-scope edit is the wrong move; the fix is to
 * stop touching that file, not widen scope. A portal into its
 * already-rendered `pane-chat` DOM node mounts the chat workspace entirely from files this ticket *can* write.
 *
 * Re-queries whenever `projectId` changes rather than once on mount:
 * `SplitPaneWorkspace` (and its pane nodes) only exists in the DOM once a
 * project is open, so a mount-only query run while still on Fleet (the
 * common path — Fleet → click Open, no full page reload) would cache a
 * permanent `null` and never portal anything in.
 */
export function useChatPaneNode(projectId: string | null): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setNode(document.querySelector<HTMLElement>('[data-testid="pane-chat"]'));
  }, [projectId]);
  return node;
}

/** Same portal pattern as `useChatPaneNode`, targeting the board pane (UX_SPEC §2a). */
export function useBoardPaneNode(projectId: string | null): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setNode(document.querySelector<HTMLElement>('[data-testid="pane-board"]'));
  }, [projectId]);
  return node;
}

/**
 * Same portal pattern as `useChatPaneNode`, targeting the artifacts pane —
 * its actual, spec'd home (UX_SPEC §5: "Artifact Viewer + Receipt
 * Inspector (right pane)"). `EstimateWorkspace` (W4-08) portaled into this
 * same node as a stopgap because its real home, the Settings Matrix
 * (UX_SPEC §6), doesn't exist yet (W4-06, still `todo`); now that this pane
 * has its rightful content producer, the estimate portal is removed here —
 * see the W4-06 HANDOFF note in plan.json for where it needs to land next.
 * Server routes/engine and `EstimateWorkspace` itself are untouched, only
 * the mount moves.
 */
export function useArtifactsPaneNode(projectId: string | null): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setNode(document.querySelector<HTMLElement>('[data-testid="pane-artifacts"]'));
  }, [projectId]);
  return node;
}
