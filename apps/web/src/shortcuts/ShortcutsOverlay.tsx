import { Fragment, useEffect, useState } from 'react';
import {
  isShortcutOverlayCloseKey,
  isShortcutOverlayOpenKey,
  shortcutsFor,
} from './shortcuts.js';

function targetDescriptor(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return {};
  return { tagName: target.tagName, isContentEditable: target.isContentEditable };
}

/**
 * Whether ⌘K/Ctrl+K actually does anything right now. Mirrors App.tsx's own
 * `CommandPalette` mount condition (`projectId` open AND no `view` layered
 * over it — Roster/Settings/Plan/etc. all replace the project canvas and
 * unmount the palette with it) without needing a prop from App.tsx: this
 * overlay renders outside App's view/project ternary (W10-34) by design, so
 * the URL — the same source of truth App.tsx itself reads — is the only
 * channel available.
 */
function isPaletteActive(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('project') !== null && params.get('view') === null;
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

  const shortcuts = shortcutsFor({ paletteActive: isPaletteActive() });

  return (
    <div className="shortcuts-overlay__backdrop" data-testid="shortcuts-overlay-backdrop">
      <div
        className="shortcuts-overlay"
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
