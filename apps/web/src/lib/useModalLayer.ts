import { useEffect, useRef, type RefObject } from 'react';

/**
 * Open modal layers, bottom to top. Only the topmost layer answers Escape and
 * Tab, so one Escape closes one layer (palette over drawer closes the palette,
 * not both).
 */
const layers: symbol[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Exported for tests. */
export function topLayerCount(): number {
  return layers.length;
}

/**
 * Makes `ref` behave as a modal layer while `active`: Escape closes it (only
 * when it is on top), Tab and Shift+Tab wrap inside it, and focus returns to
 * whatever had it before the layer opened.
 */
export function useModalLayer(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const id = Symbol('modal-layer');
    layers.push(id);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (layers[layers.length - 1] !== id) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !ref.current) return;
      const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const current = document.activeElement;
      const inside = current instanceof Node && ref.current.contains(current);
      if (event.shiftKey && (current === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };

    // Capture phase, so the top layer acts before any bubble-phase listener.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      const index = layers.indexOf(id);
      if (index >= 0) layers.splice(index, 1);
      if (opener?.isConnected) opener.focus();
    };
  }, [active, ref]);
}
