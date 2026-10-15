/**
 * Opening the palette without a keyboard. The palette owns its own `open`
 * state (it is mounted once, in the app shell); a pointer or touch user
 * reaches it through the header's Search button, which dispatches this
 * window event — the same channel ⌘K/Ctrl+K arrives on, so there is still
 * exactly one place that decides the palette is open.
 */
export const OPEN_PALETTE_EVENT = 'dokima:open-command-palette';

export function requestOpenPalette(): void {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}
