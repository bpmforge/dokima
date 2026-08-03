/**
 * Pure predicates for the keyboard-shortcut overlay (modern-product
 * baseline, W4-01). Deliberately DOM-free (a plain descriptor, not an
 * `EventTarget`) so this logic is testable under vitest's default `node`
 * environment — the browser-only DOM inspection lives in the React hook
 * that calls these.
 */

export interface Shortcut {
  keys: string;
  description: string;
}

export interface ShortcutsContext {
  /** Whether `CommandPalette` (`palette/shortcuts.ts`'s ⌘K/Ctrl+K) is
   * actually mounted right now. False on the Fleet screen and in any
   * project sub-view (Roster, Settings, Plan, …) — listing the shortcut
   * there would document a key that does nothing (W10-34). */
  paletteActive: boolean;
}

/** The overlay's row list for the given context — always '?' and Esc, plus the palette shortcut only where it actually does something. */
export function shortcutsFor(context: ShortcutsContext): readonly Shortcut[] {
  const shortcuts: Shortcut[] = [
    { keys: '?', description: 'Toggle this shortcuts overlay' },
    { keys: 'Esc', description: 'Close overlay / dismiss' },
  ];
  if (context.paletteActive) {
    shortcuts.push({ keys: '⌘K / Ctrl+K', description: 'Open command palette' });
  }
  return shortcuts;
}

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export interface TargetDescriptor {
  tagName?: string;
  isContentEditable?: boolean;
}

function isEditableTarget(target: TargetDescriptor): boolean {
  return (
    (target.tagName !== undefined && TEXT_ENTRY_TAGS.has(target.tagName)) ||
    target.isContentEditable === true
  );
}

/** '?' opens the overlay, unless the user is typing in a field. */
export function isShortcutOverlayOpenKey(event: {
  key: string;
  target: TargetDescriptor;
}): boolean {
  return event.key === '?' && !isEditableTarget(event.target);
}

export function isShortcutOverlayCloseKey(event: { key: string }): boolean {
  return event.key === 'Escape';
}
