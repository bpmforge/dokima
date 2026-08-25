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
import { TeamList, type QueueRow } from './TeamList.js';
import { WaitingRoom } from './WaitingRoom.js';
import { fetchFounderQueue, type FounderQueue } from './founderQueue.js';
import { WorkDiary } from './WorkDiary.js';
import { buildWorkDiary } from './diary.js';
import type { FounderAsk } from './memberState.js';
import type { TeamMember } from './types.js';

/** Per-viewer view choice (§10a). */
const TEAM_VIEW_KEY = 'dokima.team.view';
/** The queue is the founder's to-do list; a stale one is worse than a slow one. */
const QUEUE_POLL_MS = 5_000;

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

  // W20-10: Otto's real queue (W20-09). The client never re-sorts or filters
  // it — doing either here would rebuild the suppression capability D-030
  // deliberately removed on the server.
  const [queue, setQueue] = useState<FounderQueue>({ depth: 0, rows: [] });
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void fetchFounderQueue({ baseUrl, token }, projectId)
        .then((q) => {
          if (!cancelled) setQueue(q);
        })
        .catch(() => {
          // An unreachable queue shows as empty rather than as a fake backlog;
          // the board and List still work.
        });
    load();
    const timer = window.setInterval(load, QUEUE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [baseUrl, token, projectId]);

  // Each queued item makes its member read blocked-on-you (UX_SPEC §10).
  const asks: FounderAsk[] = queue.rows.map((r) => ({
    actorId: r.actorId,
    ticketId: r.ticketId,
    title: r.title,
  }));

  // W20-11 (§10a): Office is the skin, List is the accessible baseline. The
  // choice is per viewer and survives a reload; a storage failure (private
  // window, blocked site data) must not break the view, so every access is
  // guarded and falls back to the office.
  const [mode, setMode] = useState<'office' | 'list'>(() => {
    try {
      return localStorage.getItem(TEAM_VIEW_KEY) === 'list' ? 'list' : 'office';
    } catch {
      return 'office';
    }
  });
  const chooseMode = useCallback((next: 'office' | 'list') => {
    setMode(next);
    try {
      localStorage.setItem(TEAM_VIEW_KEY, next);
    } catch {
      // A viewer who cannot persist still gets the view they clicked.
    }
  }, []);

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

  const queueRows: readonly QueueRow[] = queue.rows.map((r) => ({
    id: r.id,
    position: r.position,
    actorId: r.actorId,
    kind: r.kind,
    title: r.title,
    reason: r.reason,
  }));

  return (
    <>
      <div className="team__viewbar">
        <span className="team__viewlabel" id="team-view-mode">
          View
        </span>
        <div className="team__seg" role="group" aria-labelledby="team-view-mode">
          <button
            type="button"
            data-testid="team-mode-office"
            aria-pressed={mode === 'office'}
            onClick={() => chooseMode('office')}
          >
            Office
          </button>
          <button
            type="button"
            data-testid="team-mode-list"
            aria-pressed={mode === 'list'}
            onClick={() => chooseMode('list')}
          >
            List
          </button>
        </div>
        <span className="team__viewhint">
          The list holds the same truth in words — and it is the accessible view.
        </span>
      </div>
      {mode === 'list' ? (
        <TeamList
          members={members}
          tickets={tickets}
          heartbeats={heartbeats}
          asks={asks}
          queue={queueRows}
          onSelect={onSelect}
          {...(onOpenDecisions ? { onAnswer: () => onOpenDecisions() } : {})}
        />
      ) : (
        <>
        <WaitingRoom
          queue={queue}
          members={members}
          {...(onOpenDecisions ? { onAnswer: () => onOpenDecisions() } : {})}
        />
        <TeamView
        members={members}
        tickets={tickets}
        heartbeats={heartbeats}
        asks={asks}
        onSelect={onSelect}
        {...(onOpenDecisions ? { onAnswer: () => onOpenDecisions() } : {})}
        />
        </>
      )}
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
