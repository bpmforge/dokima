import type { ProjectCard } from './types.js';

/**
 * UX_SPEC §2: "Cards sort by 'needs you first' (pending Decide desc, then
 * stalest heartbeat)". W17-09 prepends the harder rule the live UAT proved:
 * the LIVING lead — a wall of dead "Unavailable" entries buried a
 * just-created project below the fold, which read as creation failing.
 */
export function sortByAttention(cards: readonly ProjectCard[]): ProjectCard[] {
  return [...cards].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.pendingDecideCount !== b.pendingDecideCount) {
      return b.pendingDecideCount - a.pendingDecideCount;
    }
    const aAge = a.heartbeatAgeMs ?? -1;
    const bAge = b.heartbeatAgeMs ?? -1;
    return bAge - aAge;
  });
}
