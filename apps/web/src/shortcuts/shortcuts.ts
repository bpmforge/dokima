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

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: '?', description: 'Toggle this shortcuts overlay' },
  { keys: 'Esc', description: 'Close overlay / dismiss' },
];

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
