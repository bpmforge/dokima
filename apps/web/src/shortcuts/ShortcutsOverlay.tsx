import { useEffect, useState } from 'react';
import {
  isShortcutOverlayCloseKey,
  isShortcutOverlayOpenKey,
  SHORTCUTS,
} from './shortcuts.js';

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
      } else if (open && isShortcutOverlayCloseKey({ key: event.key })) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="shortcuts-overlay"
      role="dialog"
      aria-label="Keyboard shortcuts"
      data-testid="shortcuts-overlay"
    >
      <h2>Keyboard shortcuts</h2>
      <dl>
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className="shortcuts-overlay__row">
            <dt>
              <kbd>{shortcut.keys}</kbd>
            </dt>
            <dd>{shortcut.description}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
