import { useEffect, useState } from 'react';
import { readPrefersReducedMotion, REDUCED_MOTION_QUERY } from './reduced-motion.js';

/** Live `prefers-reduced-motion` state; also mirrored to `<html data-reduced-motion>` for CSS. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => readPrefersReducedMotion());

  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reduced);
  }, [reduced]);

  return reduced;
}
