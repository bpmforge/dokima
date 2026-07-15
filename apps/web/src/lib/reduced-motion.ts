/** `prefers-reduced-motion` (modern-product baseline, W4-01). */

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function readPrefersReducedMotion(
  matchMedia: (query: string) => { matches: boolean } = window.matchMedia.bind(window),
): boolean {
  return matchMedia(REDUCED_MOTION_QUERY).matches;
}
