/**
 * Split-pane workspace layout persistence (FR-C1, W4-01 scaffold acceptance
 * amendment). Pane *content* (chat/board/artifact viewer) lands in later
 * W4 tickets; this ticket owns the resizable/collapsible shell and its
 * per-project persistence — pane sizes, collapsed state, and active view
 * survive a restart, and different projects hold independent layouts.
 */

export type PaneId = 'chat' | 'board' | 'artifacts';

export const PANE_IDS: readonly PaneId[] = ['chat', 'board', 'artifacts'];

export interface PaneState {
  sizePct: number;
  collapsed: boolean;
}

export interface PaneLayout {
  panes: Record<PaneId, PaneState>;
  activeView: PaneId;
}

export const MIN_PANE_PCT = 15;
export const MAX_PANE_PCT = 70;

export function defaultLayout(): PaneLayout {
  return {
    panes: {
      chat: { sizePct: 34, collapsed: false },
      board: { sizePct: 33, collapsed: false },
      artifacts: { sizePct: 33, collapsed: false },
    },
    activeView: 'board',
  };
}

export function clampPaneSize(pct: number): number {
  return Math.min(MAX_PANE_PCT, Math.max(MIN_PANE_PCT, pct));
}

export function paneLayoutStorageKey(projectId: string): string {
  return `dokima.paneLayout.${projectId}`;
}

export function serializePaneLayout(layout: PaneLayout): string {
  return JSON.stringify(layout);
}

function isPaneState(value: unknown): value is PaneState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sizePct === 'number' && typeof candidate.collapsed === 'boolean'
  );
}

function isPaneLayout(value: unknown): value is PaneLayout {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.activeView !== 'string' ||
    !PANE_IDS.includes(candidate.activeView as PaneId)
  ) {
    return false;
  }
  if (typeof candidate.panes !== 'object' || candidate.panes === null) return false;
  const panes = candidate.panes as Record<string, unknown>;
  return PANE_IDS.every((id) => isPaneState(panes[id]));
}

/** Returns `undefined` on missing/corrupt data — caller falls back to `defaultLayout()`. */
export function deserializePaneLayout(raw: string | null): PaneLayout | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return isPaneLayout(parsed) ? parsed : undefined;
}
