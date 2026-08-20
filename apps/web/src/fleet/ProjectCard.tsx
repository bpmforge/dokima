import type { ProjectCard as ProjectCardData } from './types.js';

/** Heartbeat older than this reads as stale — placeholder cadence pending W3-04 berths. */
const STALE_HEARTBEAT_MS = 2 * 60_000;

function formatHeartbeat(ageMs: number | null): string {
  if (ageMs === null) return 'no agent running';
  if (ageMs < 5_000) return 'live';
  return `${Math.round(ageMs / 1000)}s ago`;
}

/** Berths-running and heartbeat-freshness are the same fact when nothing is running — say it once. */
function berthsSummary(berthsRunning: number, heartbeatAgeMs: number | null): string {
  if (berthsRunning === 0) return 'No agents running';
  return `${berthsRunning} agent${berthsRunning === 1 ? '' : 's'} running · ${formatHeartbeat(heartbeatAgeMs)}`;
}

export interface ProjectCardProps {
  card: ProjectCardData;
  archivedView: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onReopen: () => void;
  onRemove: () => void;
}

export function ProjectCard({
  card,
  archivedView,
  onOpen,
  onArchive,
  onReopen,
  onRemove,
}: ProjectCardProps) {
  const stale = card.heartbeatAgeMs !== null && card.heartbeatAgeMs > STALE_HEARTBEAT_MS;

  /**
   * W13-05: THE CARD'S SHAPE CARRIES ITS STATE. Six cards read
   * "Not started · Ready 0 · Blocked 0 · Done 0 · No berths running · $0.00
   * today", and the one project with work waiting was indistinguishable from
   * five with none — which is the exact opposite of the Fleet's stated job
   * (UX_SPEC §2: cards sort "needs you first").
   *
   * Three levels, not two, because "a decision is waiting" and "there is work
   * to do" are different claims on a person: only the first should shout.
   */
  const needsYou = card.pendingDecideCount > 0;
  const busy =
    card.board.ready > 0 ||
    card.board.blocked > 0 ||
    card.board.done > 0 ||
    card.berthsRunning > 0;
  const surfaceState = needsYou ? ' surface--attention' : busy ? '' : ' surface--idle';

  // W9-15: a project whose directory has vanished is NOT rendered as an
  // ordinary card with zeroed stats — zeros there are indistinguishable from a
  // real, empty project. It gets its own state and the one action that can help.
  if (!card.available) {
    return (
      <article
        className="project-card project-card--unavailable"
        data-testid={`project-card-${card.id}`}
        data-unavailable="true"
      >
        <header className="project-card__header">
          <h2>{card.name}</h2>
          <span className="project-card__phase-chip project-card__phase-chip--unavailable">
            Unavailable
          </span>
        </header>

        <p className="project-card__unavailable-note">
          This folder is gone — nothing at <code>{card.path}</code>. It was moved,
          renamed, or deleted. Its stats can&rsquo;t be read, so none are shown.
        </p>

        <footer className="project-card__actions">
          <button type="button" onClick={onRemove}>
            Remove from Fleet
          </button>
        </footer>
        <p className="project-card__unavailable-hint">
          Removing only forgets this entry. Nothing on disk is touched, and onboarding the
          folder again restores it.
        </p>
      </article>
    );
  }

  return (
    <article
      className={`project-card surface${surfaceState}`}
      data-testid={`project-card-${card.id}`}
    >
      <header className="project-card__header">
        <h2>{card.name}</h2>
        <span className="project-card__phase-chip">
          {card.phase === null ? 'Not started' : `Phase ${card.phase}`}
        </span>
      </header>

      {/* W13-05: readouts, not prose. The value carries at size in tabular
          mono; the label is a micro cap beneath it. A zero recedes, because a
          reading of nothing is not news — that is what lets the eye find the
          one card that has something. */}
      <dl className="project-card__board">
        {(
          [
            ['Ready', card.board.ready],
            ['Blocked', card.board.blocked],
            ['Done', card.board.done],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className={`readout${value === 0 ? ' readout--idle' : ''}`}>
            <dd className="readout__value">{value}</dd>
            <dt className="readout__label">{label}</dt>
          </div>
        ))}
      </dl>

      {/* The shared state vocabulary (W13-04), so this line and a board lane
          say the same thing the same way. `.state` draws its own dot. */}
      <div
        className={`project-card__berths state ${
          card.berthsRunning === 0
            ? 'state--idle'
            : stale
              ? 'state--blocked'
              : 'state--running'
        }`}
      >
        {berthsSummary(card.berthsRunning, card.heartbeatAgeMs)}
      </div>

      {card.pendingDecideCount > 0 && (
        <div
          className="project-card__decide state state--attention"
          data-testid="decide-count"
        >
          {card.pendingDecideCount} needs you
        </div>
      )}

      <div className="project-card__spend tabular">
        ${card.spendTodayUsd.toFixed(2)} today
      </div>

      <footer className="project-card__actions">
        {archivedView ? (
          <button type="button" onClick={onReopen}>
            Reopen
          </button>
        ) : (
          <>
            {/* W13-05: Open is what you do every time; Archive is rare and
                semi-destructive. They rendered at identical weight. */}
            <button type="button" className="btn-primary" onClick={onOpen}>
              Open
            </button>
            <button type="button" className="btn-quiet" onClick={onArchive}>
              Archive
            </button>
          </>
        )}
      </footer>
    </article>
  );
}
