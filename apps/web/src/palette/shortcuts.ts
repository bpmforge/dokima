/**
 * Pure predicate for the ⌘K/Ctrl+K command-palette toggle (UX_SPEC §2a),
 * DOM-free like `shortcuts/shortcuts.ts` for the same testability reason.
 * Fires even while focus is in a text field (a real ⌘K convention —
 * bookmark-manager/command-palette shortcuts always win over typing), so
 * unlike the '?' overlay this has no editable-target exclusion.
 */
export function isPaletteOpenKey(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
}

export function isPaletteCloseKey(event: { key: string }): boolean {
  return event.key === 'Escape';
}

/** Whether the viewer is on a Mac-family platform, where the modifier is ⌘ rather than Ctrl. */
export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The shortcut as the header button shows it: "⌘K" on a Mac, "Ctrl+K" elsewhere. */
export function paletteShortcutLabel(platform: string): string {
  return isMacPlatform(platform) ? '⌘K' : 'Ctrl+K';
}
