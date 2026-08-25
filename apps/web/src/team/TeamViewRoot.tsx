/**
 * Team view container (W20-02): joins the roster's faces (W20-01) to the live
 * board projection, then hands both to `TeamView`. No state is computed here —
 * `deriveMemberState` owns that, once, for every Team surface.
 */
import { useCallback, useEffect, useState } from 'react';
import { useBoardData } from '../board/useBoardData.js';
import { fetchRunTraceAll } from '../board/drawer/api.js';
import type { TraceEvent } from '../board/drawer/types.js';
import { fetchRoster } from '../roster/api.js';
import type { RosterExpert } from '../roster/types.js';
import { TeamView } from './TeamView.js';
import { WorkDiary } from './WorkDiary.js';
import { buildWorkDiary } from './diary.js';
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

  // W20-09 supplies the real founder queue; until W20-10 wires it in, the Team
  // view shows no blocked-on-you state rather than guessing one (D-028).
  const asks: FounderAsk[] = [];

  // W20-03: the selected member's own event slice, humanised.
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<readonly TraceEvent[]>([]);
  const onSelect = useCallback(
    (actorId: string) => {
      setSelected(actorId);
      void fetchRunTraceAll({ baseUrl, token }, projectId, '')
        .then(setEvents)
        .catch(() => setEvents([]));
    },
    [baseUrl, token, projectId],
  );

  const selectedMember = members.find((m) => m.actorId === selected);
  const diary = selected ? buildWorkDiary(events, selected) : null;

  return (
    <>
      <TeamView
        members={members}
        tickets={tickets}
        heartbeats={heartbeats}
        asks={asks}
        onSelect={onSelect}
        {...(onOpenDecisions ? { onAnswer: () => onOpenDecisions() } : {})}
      />
      {selectedMember && diary && (
        <section className="team__drawer surface" data-testid="team-diary-drawer">
          <h3>
            What {selectedMember.displayName ?? selectedMember.actorId} actually did
          </h3>
          <WorkDiary
            displayName={selectedMember.displayName ?? selectedMember.actorId}
            entries={diary.entries}
            total={diary.total}
          />
        </section>
      )}
    </>
  );
}
