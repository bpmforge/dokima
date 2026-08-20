import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  clampPaneSize,
  defaultLayout,
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

function loadLayout(storageKey: string): PaneLayout {
  return (
    deserializePaneLayout(window.localStorage.getItem(storageKey)) ?? defaultLayout()
  );
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
    window.localStorage.setItem(storageKey, serializePaneLayout(layout));
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

  const startResize = useCallback(
    (leftId: PaneId, rightId: PaneId) =>
      (downEvent: ReactPointerEvent<HTMLDivElement>) => {
        downEvent.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const startX = downEvent.clientX;

        const onMove = (moveEvent: PointerEvent) => {
          const deltaPct = ((moveEvent.clientX - startX) / rect.width) * 100;
          setLayout((current) => {
            const left = current.panes[leftId];
            const right = current.panes[rightId];
            return {
              ...current,
              panes: {
                ...current.panes,
                [leftId]: { ...left, sizePct: clampPaneSize(left.sizePct + deltaPct) },
                [rightId]: { ...right, sizePct: clampPaneSize(right.sizePct - deltaPct) },
              },
            };
          });
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
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
                onPointerDown={startResize(id, next)}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
