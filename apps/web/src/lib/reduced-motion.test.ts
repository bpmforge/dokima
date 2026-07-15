import { describe, expect, it, vi } from 'vitest';
import { readPrefersReducedMotion, REDUCED_MOTION_QUERY } from './reduced-motion.js';

describe('readPrefersReducedMotion', () => {
  it('queries prefers-reduced-motion and returns its match state', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    expect(readPrefersReducedMotion(matchMedia)).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
  });

  it('returns false when the user has not requested reduced motion', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: false });
    expect(readPrefersReducedMotion(matchMedia)).toBe(false);
  });
});
