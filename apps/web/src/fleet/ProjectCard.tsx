import type { ProjectCard as ProjectCardData } from './types.js';

/** Heartbeat older than this reads as stale — placeholder cadence pending W3-04 berths. */
const STALE_HEARTBEAT_MS = 2 * 60_000;

function formatHeartbeat(ageMs: number | null): string {
  if (ageMs === null) return 'no active berth';
  if (ageMs < 5_000) return 'live';
  return `${Math.round(ageMs / 1000)}s ago`;
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
    <article className="project-card" data-testid={`project-card-${card.id}`}>
      <header className="project-card__header">
        <h2>{card.name}</h2>
        <span className="project-card__phase-chip">
          {card.phase === null ? 'Not started' : `Phase ${card.phase}`}
        </span>
      </header>

      <dl className="project-card__board">
        <div>
          <dt>Ready</dt>
          <dd>{card.board.ready}</dd>
        </div>
        <div>
          <dt>Blocked</dt>
          <dd>{card.board.blocked}</dd>
        </div>
        <div>
          <dt>Done</dt>
          <dd>{card.board.done}</dd>
        </div>
      </dl>

      <div className="project-card__berths">
        <span
          className={`project-card__heartbeat-dot${stale ? ' project-card__heartbeat-dot--stale' : ''}`}
          aria-hidden="true"
        />
        {card.berthsRunning} berth{card.berthsRunning === 1 ? '' : 's'} running ·{' '}
        {formatHeartbeat(card.heartbeatAgeMs)}
      </div>

      {card.pendingDecideCount > 0 && (
        <div className="project-card__decide" data-testid="decide-count">
          {card.pendingDecideCount} needs you
        </div>
      )}

      <div className="project-card__spend">${card.spendTodayUsd.toFixed(2)} today</div>

      <footer className="project-card__actions">
        {archivedView ? (
          <button type="button" onClick={onReopen}>
            Reopen
          </button>
        ) : (
          <>
            <button type="button" onClick={onOpen}>
              Open
            </button>
            <button type="button" onClick={onArchive}>
              Archive
            </button>
          </>
        )}
      </footer>
    </article>
  );
}
