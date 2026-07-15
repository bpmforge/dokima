import type { ProjectCard } from './types.js';

/** UX_SPEC §2: "Cards sort by 'needs you first' (pending Decide desc, then stalest heartbeat)". */
export function sortByAttention(cards: readonly ProjectCard[]): ProjectCard[] {
  return [...cards].sort((a, b) => {
    if (a.pendingDecideCount !== b.pendingDecideCount) {
      return b.pendingDecideCount - a.pendingDecideCount;
    }
    const aAge = a.heartbeatAgeMs ?? -1;
    const bAge = b.heartbeatAgeMs ?? -1;
    return bAge - aAge;
  });
}
