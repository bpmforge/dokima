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

/**
 * W12-30: the board gets the room its content needs.
 *
 * This was an even 34/33/33, which meant the pane this same function marks as
 * `activeView` received the smallest-equal share of the window — ~470px at
 * 1440px. Six lifecycle states cannot fit in 470px, so `board.css`'s grid
 * correctly wrapped them 3x2 and a kanban board stopped reading as a pipeline.
 * The layout was the cause; the grid was the symptom, and its measured
 * `auto-fit`/`minmax` behaviour is deliberately left untouched — it simply
 * fits more states per row once the pane is wide enough.
 *
 * 58% is ~835px at 1440px, which fits all SIX 8.5rem columns plus gaps — the
 * whole lifecycle on one row, which is the point of a board. Both side panes
 * stay above MIN_PANE_PCT (15) and remain user-draggable. This changes a
 * DEFAULT, not a constraint: anyone who preferred an even split can still drag
 * to it, and the choice persists per project (W4 split-pane persistence).
 */
export function defaultLayout(): PaneLayout {
  return {
    panes: {
      chat: { sizePct: 21, collapsed: false },
      board: { sizePct: 58, collapsed: false },
      artifacts: { sizePct: 21, collapsed: false },
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
