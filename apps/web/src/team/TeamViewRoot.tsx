/**
 * Team view container (W20-02): joins the roster's faces (W20-01) to the live
 * board projection, then hands both to `TeamView`. No state is computed here —
 * `deriveMemberState` owns that, once, for every Team surface.
 */
import { useEffect, useState } from 'react';
import { useBoardData } from '../board/useBoardData.js';
import { fetchRoster } from '../roster/api.js';
import type { RosterExpert } from '../roster/types.js';
import { TeamView } from './TeamView.js';
import type { FounderAsk } from './memberState.js';
import type { TeamMember } from './types.js';

export interface TeamViewRootProps {
  readonly projectId: string;
  readonly baseUrl: string;
  readonly token: string;
  readonly wsUrl: string;
  readonly onOpenDecisions?: () => void;
}

/** Emoji stand-ins for the avatar keys until the sprite sheet lands (W20-08). */
const AVATAR: Record<string, string> = {
  'ida-interviewer': '💡',
  'scout-researcher': '🧭',
  'blue-architect': '📐',
  'dex-api': '🔌',
  'sketch-ux': '✏️',
  'locke-security': '🔐',
  'tess-tests': '🧪',
  'sam-builder': '🔨',
  'shipp-release': '🚢',
  'wiggum-challenger': '🔍',
  'vera-verifier': '🧾',
  'otto-chief': '📋',
};

function toMember(expert: RosterExpert): TeamMember {
  // D-028: no persona -> no invented face; TeamView then renders the raw id.
  return {
    actorId: expert.id,
    role: expert.id,
    ...(expert.persona
      ? {
          displayName: expert.persona.displayName,
          avatar: AVATAR[expert.persona.avatarKey] ?? '•',
          jobLine: expert.persona.jobLine,
        }
      : {}),
  };
}

export function TeamViewRoot({
  projectId,
  baseUrl,
  token,
  wsUrl,
  onOpenDecisions,
}: TeamViewRootProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const { tickets, heartbeats } = useBoardData({ baseUrl, token, projectId, wsUrl });

  useEffect(() => {
    let cancelled = false;
    void fetchRoster({ projectId })
      .then((experts) => {
        if (!cancelled) setMembers(experts.map(toMember));
      })
      .catch(() => {
        // TeamView's empty state says the roster did not load and points at
        // the board — an error banner here would be a second way to say it.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, baseUrl, token]);

  // W20-09 supplies the real founder queue; until it lands the Team view shows
  // no blocked-on-you state rather than guessing one (D-028).
  const asks: FounderAsk[] = [];

  return (
    <TeamView
      members={members}
      tickets={tickets}
      heartbeats={heartbeats}
      asks={asks}
      {...(onOpenDecisions ? { onAnswer: () => onOpenDecisions() } : {})}
    />
  );
}
