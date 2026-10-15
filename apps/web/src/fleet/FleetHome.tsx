import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  archiveProject as archiveProjectRequest,
  createProject as createProjectRequest,
  fetchProjects,
  FleetApiError,
  removeProject as removeProjectRequest,
} from './api.js';
import { ArmedButton } from '../lib/ArmedButton.js';
import { NewProjectForm } from './NewProjectForm.js';
import { ProjectCard } from './ProjectCard.js';
import { sortByAttention } from './sort.js';
import type {
  CreateProjectInput,
  ProjectCard as ProjectCardData,
  ProjectMode,
} from './types.js';
import './fleet.css';
import { EmptyState } from './EmptyState.js';

/** Live-update substitute (FR-F1's WS push is deferred — see HANDOFF in plan.json). */
const POLL_INTERVAL_MS = 5_000;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof FleetApiError ? err.message : fallback;
}

export interface FleetHomeProps {
  onOpenProject: (id: string) => void;
  onOpenGuidedSample: () => void;
}

export function FleetHome({ onOpenProject, onOpenGuidedSample }: FleetHomeProps) {
  const [archivedFilter, setArchivedFilter] = useState(false);
  const [cards, setCards] = useState<ProjectCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<ProjectMode | null>(null);

  const refresh = useCallback(async () => {
    try {
      const projects = await fetchProjects({ archived: archivedFilter });
      setCards(projects);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load projects'));
    } finally {
      setLoading(false);
    }
  }, [archivedFilter]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const sorted = useMemo(() => sortByAttention(cards), [cards]);

  const handleCreate = useCallback(
    async (input: CreateProjectInput) => {
      const created = await createProjectRequest(input);
      setFormMode(null);
      // W17-09: a just-created project OPENS — the live UAT buried it below
      // a wall of dead cards and creation read as failure.
      onOpenProject(created.id);
    },
    [onOpenProject],
  );

  // Archive is reversible (Reopen keeps the same project), so it says what
  // happened and offers the undo right where the card was.
  const [lastArchived, setLastArchived] = useState<{ name: string; path: string } | null>(
    null,
  );
  const handleArchive = useCallback(
    async (id: string) => {
      const card = cards.find((c) => c.id === id);
      await archiveProjectRequest(id);
      if (card) setLastArchived({ name: card.name, path: card.path });
      await refresh();
    },
    [cards, refresh],
  );

  /** W9-15: forgets the registry entry only — the server never touches the folder. */
  const handleRemove = useCallback(
    async (id: string) => {
      await removeProjectRequest(id);
      await refresh();
    },
    [refresh],
  );

  // W17-09: one confirmed action for the whole graveyard. Same honest
  // removal semantics as the per-card button: registry entries only,
  // nothing on disk, onboarding a folder again restores it. W18-01 made
  // the confirmation two clicks on the button itself — the native dialog
  // it replaced blocked the whole tab.
  const unavailableCount = sorted.filter((card) => !card.available).length;
  const handleRemoveUnavailable = useCallback(async () => {
    const gone = cards.filter((card) => !card.available);
    for (const card of gone) await removeProjectRequest(card.id);
    await refresh();
  }, [cards, refresh]);

  const handleReopen = useCallback(
    async (projectPath: string) => {
      await createProjectRequest({ path: projectPath, mode: 'import' });
      await refresh();
    },
    [refresh],
  );

  // W13-58: on a FRESH install the one thing to do first is setup, so the
  // empty state's "Set up Dokima" holds the screen's single primary slot
  // (W12-29's law) and the header's New project steps down until a project
  // exists.
  const setupIsPrimary = !loading && !formMode && sorted.length === 0 && !archivedFilter;

  return (
    <div className="page fleet" data-testid="fleet-home">
      <header className="fleet__header">
        <h1 className="page__title">Fleet</h1>
        <div className="fleet__actions">
          {/* W12-29: one primary per screen. With projects on the board, New
              project is what a person came to Fleet to do; on a cold start
              the empty state's Set up Dokima outranks it (W13-58). */}
          <button
            type="button"
            className={setupIsPrimary ? 'btn-secondary' : 'btn-primary'}
            onClick={() => setFormMode('new')}
          >
            New project
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setFormMode('onboard')}
          >
            Onboard existing repo
          </button>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => setFormMode('import')}
          >
            Import
          </button>
          <label className="fleet__archived-toggle">
            <input
              type="checkbox"
              checked={archivedFilter}
              onChange={(event) => setArchivedFilter(event.target.checked)}
            />
            Show archived
          </label>
          {unavailableCount > 0 && (
            <ArmedButton
              className="btn-quiet"
              testId="fleet-remove-unavailable"
              label={`Remove ${unavailableCount} unavailable`}
              armedLabel={`Really remove ${unavailableCount}? Click again`}
              onConfirm={handleRemoveUnavailable}
            />
          )}
        </div>
      </header>
      <p className="fleet__notice" role="status" data-testid="fleet-archive-status">
        {lastArchived && (
          <>
            Archived {lastArchived.name}.{' '}
            <button
              type="button"
              className="btn-quiet"
              data-testid="fleet-archive-undo"
              onClick={() => {
                const { path } = lastArchived;
                setLastArchived(null);
                void handleReopen(path);
              }}
            >
              Undo
            </button>
          </>
        )}
      </p>
      {/* W18-08: the removal semantics, stated once for the whole page —
          each dead card used to repeat this paragraph. */}
      {unavailableCount > 0 && (
        <p className="fleet__unavailable-hint" data-testid="fleet-unavailable-hint">
          Removing an unavailable entry only forgets it — nothing on disk is touched,
          and onboarding the folder again restores it.
        </p>
      )}

      {formMode && (
        <NewProjectForm
          mode={formMode}
          onCancel={() => setFormMode(null)}
          onSubmit={handleCreate}
        />
      )}

      {error && (
        <p className="fleet__error" role="alert">
          {error}
        </p>
      )}

      {/* W13-53 (UX_AUDIT A-5): the fleet-wide readings. Fleet's job is
          "what needs me?" across every project, and the answer was only
          derivable by scanning N cards. One strip of readouts answers it
          before the eye reaches the grid — and gives the page the horizontal
          structure it lacked (two cards floating in a void). */}
      {!loading && !formMode && sorted.length > 0 && (
        <dl
          className="fleet__summary surface"
          data-testid="fleet-summary"
          aria-label="All projects combined"
        >
          {/* W13-62: the strip renders with the same readout styling the
              per-project cards use — without this caption a novice reads the
              totals as belonging to the nearest project. */}
          <div className="fleet__summary-caption">All projects</div>
          {(() => {
            const total = (pick: (c: (typeof sorted)[number]) => number) =>
              sorted.reduce((sum, c) => sum + pick(c), 0);
            const readings: {
              label: string;
              value: number | string;
              tone?: 'attention' | 'blocked';
              idle: boolean;
            }[] = [
              {
                label: 'ready',
                value: total((c) => c.board.ready),
                idle: total((c) => c.board.ready) === 0,
              },
              {
                // Review UI-11: blocked is stuck, not "needs a person" — the
                // warning tone, never the accent.
                label: 'blocked',
                value: total((c) => c.board.blocked),
                ...(total((c) => c.board.blocked) > 0 ? { tone: 'blocked' as const } : {}),
                idle: total((c) => c.board.blocked) === 0,
              },
              {
                label: 'needs you',
                value: total((c) => c.pendingDecideCount),
                ...(total((c) => c.pendingDecideCount) > 0
                  ? { tone: 'attention' as const }
                  : {}),
                idle: total((c) => c.pendingDecideCount) === 0,
              },
              {
                label: 'agents running',
                value: total((c) => c.berthsRunning),
                idle: total((c) => c.berthsRunning) === 0,
              },
              {
                label: 'spend today',
                value: `$${total((c) => Math.round(c.spendTodayUsd * 100) / 100).toFixed(2)}`,
                // Idle from the number, not the formatted string: "$0.00" was
                // never `=== 0`, so a zero spend never receded.
                idle: total((c) => c.spendTodayUsd) === 0,
              },
            ];
            return readings.map((r) => (
              <div
                key={r.label}
                className={`readout${r.tone ? ` readout--${r.tone}` : ''}${
                  r.idle ? ' readout--idle' : ''
                }`}
              >
                <dd className="readout__value">{r.value}</dd>
                <dt className="readout__label">{r.label}</dt>
              </div>
            ));
          })()}
        </dl>
      )}

      {!loading && !formMode && sorted.length === 0 ? (
        <EmptyState
          archived={archivedFilter}
          onNewProduct={() => setFormMode('new')}
          onOnboard={() => setFormMode('onboard')}
          onOpenGuidedSample={onOpenGuidedSample}
        />
      ) : (
        <div className="fleet__grid" data-testid="fleet-grid">
          {sorted.map((card) => (
            <ProjectCard
              key={card.id}
              card={card}
              archivedView={archivedFilter}
              onOpen={() => onOpenProject(card.id)}
              onArchive={() => void handleArchive(card.id)}
              onReopen={() => void handleReopen(card.path)}
              onRemove={() => void handleRemove(card.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
