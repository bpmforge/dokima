import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useModalLayer } from '../lib/useModalLayer.js';
import { isShortcutOverlayOpenKey, shortcutsFor } from './shortcuts.js';

function targetDescriptor(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return {};
  return { tagName: target.tagName, isContentEditable: target.isContentEditable };
}

/** Global '?' listener + the overlay it toggles (modern-product baseline, W4-01). */
export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        isShortcutOverlayOpenKey({
          key: event.key,
          target: targetDescriptor(event.target),
        })
      ) {
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useModalLayer(dialogRef, close, open);

  if (!open) return null;

  const shortcuts = shortcutsFor();

  return (
    <div className="shortcuts-overlay__backdrop" data-testid="shortcuts-overlay-backdrop">
      <div
        ref={dialogRef}
        className="shortcuts-overlay"
        tabIndex={-1}
        role="dialog"
        aria-label="Keyboard shortcuts"
        data-testid="shortcuts-overlay"
      >
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts-overlay__list">
          {shortcuts.map((shortcut) => (
            <Fragment key={shortcut.keys}>
              <dt>
                <kbd>{shortcut.keys}</kbd>
              </dt>
              <dd>{shortcut.description}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </div>
  );
}
