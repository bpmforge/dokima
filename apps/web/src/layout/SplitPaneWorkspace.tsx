import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  defaultLayout,
  MAX_PANE_PCT,
  MIN_PANE_PCT,
  resizePanePair,
  deserializePaneLayout,
  paneLayoutStorageKey,
  PANE_IDS,
  serializePaneLayout,
  type PaneId,
  type PaneLayout,
  focusPane,
  isFocused,
  unfocusPanes,
} from './paneLayout.js';

const PANE_LABELS: Record<PaneId, string> = {
  chat: 'Chat',
  board: 'Board',
  artifacts: 'Artifacts',
};

// Storage can throw (site data blocked); the workspace must still render.
function loadLayout(storageKey: string): PaneLayout {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    raw = null;
  }
  return deserializePaneLayout(raw) ?? defaultLayout();
}

export interface SplitPaneWorkspaceProps {
  /** Fleet lands the real project id in a later ticket; default keeps this ticket self-contained. */
  projectId?: string;
}

/** Resizable/collapsible three-pane shell (FR-C1); pane content lands in later W4 tickets. */
export function SplitPaneWorkspace({ projectId = 'default' }: SplitPaneWorkspaceProps) {
  const storageKey = paneLayoutStorageKey(projectId);
  const [layout, setLayout] = useState<PaneLayout>(() => loadLayout(storageKey));
  const containerRef = useRef<HTMLDivElement>(null);

  // Different project => independent, freshly-loaded layout.
  useEffect(() => {
    setLayout(loadLayout(storageKey));
  }, [storageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, serializePaneLayout(layout));
    } catch {
      // Not persisted this session; the layout still works in memory.
    }
  }, [layout, storageKey]);

  const toggleCollapsed = useCallback((id: PaneId) => {
    setLayout((current) => ({
      ...current,
      panes: {
        ...current.panes,
        [id]: { ...current.panes[id], collapsed: !current.panes[id].collapsed },
      },
    }));
  }, []);

  /**
   * W12-34: focus this pane, or leave focus if it is already focused. The
   * layout in force beforehand is saved and restored, so a user who dragged
   * their own split gets it back rather than the default.
   */
  const toggleFocus = useCallback((id: PaneId) => {
    setLayout((current) => (isFocused(current) ? unfocusPanes(current) : focusPane(current, id)));
  }, []);

  // Latest layout for event handlers that snapshot it at gesture start.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const startResize = useCallback(
    (leftId: PaneId, rightId: PaneId) =>
      (downEvent: ReactPointerEvent<HTMLDivElement>) => {
        downEvent.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const startX = downEvent.clientX;
        // Every move is measured from this snapshot, so the size can't compound.
        const start = layoutRef.current;
        downEvent.currentTarget.setPointerCapture?.(downEvent.pointerId);

        const onMove = (moveEvent: PointerEvent) => {
          const deltaPct = ((moveEvent.clientX - startX) / rect.width) * 100;
          setLayout(resizePanePair(start, leftId, rightId, deltaPct));
        };
        const stop = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', stop);
          window.removeEventListener('keydown', onKey, true);
        };
        // Escape mid-drag puts the split back where it started.
        const onKey = (keyEvent: KeyboardEvent) => {
          if (keyEvent.key !== 'Escape') return;
          keyEvent.preventDefault();
          keyEvent.stopImmediatePropagation();
          setLayout(start);
          stop();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', stop);
        window.addEventListener('keydown', onKey, true);
      },
    [],
  );

  const resizeWithKeys = useCallback(
    (leftId: PaneId, rightId: PaneId) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 10 : 2;
      const current = layoutRef.current;
      let delta: number;
      if (event.key === 'ArrowLeft') delta = -step;
      else if (event.key === 'ArrowRight') delta = step;
      else if (event.key === 'Home') delta = -100;
      else if (event.key === 'End') delta = 100;
      else return;
      event.preventDefault();
      setLayout(resizePanePair(current, leftId, rightId, delta));
    },
    [],
  );

  return (
    <div className="split-pane" ref={containerRef} data-testid="split-pane-workspace">
      {PANE_IDS.map((id, index) => {
        const pane = layout.panes[id];
        const next = PANE_IDS[index + 1];
        return (
          <Fragment key={id}>
            <section
              className="split-pane__pane"
              data-testid={`pane-${id}`}
              data-collapsed={pane.collapsed}
              style={{ flexBasis: pane.collapsed ? '2.5rem' : `${pane.sizePct}%` }}
            >
              <header className="split-pane__pane-header">
                <span>{PANE_LABELS[id]}</span>
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => toggleFocus(id)}
                  aria-label={
                    isFocused(layout)
                      ? 'Leave focus and restore the previous layout'
                      : `Focus ${PANE_LABELS[id]} and collapse the other panes`
                  }
                  data-testid={`focus-${id}`}
                  title={
                    isFocused(layout)
                      ? 'Leave focus and restore the previous layout'
                      : `Focus ${PANE_LABELS[id]} and collapse the other panes`
                  }
                >
                  {isFocused(layout) ? 'Unfocus' : 'Focus'}
                </button>
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => toggleCollapsed(id)}
                  aria-label={`${pane.collapsed ? 'Expand' : 'Collapse'} ${PANE_LABELS[id]}`}
                  title={`${pane.collapsed ? 'Expand' : 'Collapse'} ${PANE_LABELS[id]}`}
                >
                  {pane.collapsed ? '»' : '«'}
                </button>
              </header>
            </section>
            {next && (
              <div
                className="split-pane__divider"
                data-testid={`divider-${id}-${next}`}
                role="separator"
                aria-orientation="vertical"
                tabIndex={0}
                aria-label={`Resize ${PANE_LABELS[id]} and ${PANE_LABELS[next]}`}
                aria-valuenow={Math.round(pane.sizePct)}
                aria-valuemin={MIN_PANE_PCT}
                aria-valuemax={MAX_PANE_PCT}
                title="Drag, or focus and use the arrow keys, to resize"
                onPointerDown={startResize(id, next)}
                onKeyDown={resizeWithKeys(id, next)}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
