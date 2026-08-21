import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  archiveProject as archiveProjectRequest,
  createProject as createProjectRequest,
  fetchProjects,
  FleetApiError,
  removeProject as removeProjectRequest,
} from './api.js';
import { ArmedButton } from '../lib/ArmedButton.js';
import { DirectoryPicker } from './DirectoryPicker.js';
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

const MODE_LABEL: Record<ProjectMode, string> = {
  new: 'New project',
  onboard: 'Onboard existing repo',
  import: 'Import',
};

/** The commit action needs its own verb — MODE_LABEL alone reads as a noun-phrase mode name, not something a button press does. */
const SUBMIT_LABEL: Record<ProjectMode, string> = {
  new: 'Create project',
  onboard: 'Onboard existing repo',
  import: 'Import',
};

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

  const handleArchive = useCallback(
    async (id: string) => {
      await archiveProjectRequest(id);
      await refresh();
    },
    [refresh],
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
    <div className="fleet" data-testid="fleet-home">
      <header className="fleet__header">
        <h1>Fleet</h1>
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
              armedDetail="Registry entries only — nothing on disk is touched, and onboarding a folder again restores it."
              title="Registry entries only — nothing on disk is touched, and onboarding a folder again restores it."
              onConfirm={handleRemoveUnavailable}
            />
          )}
        </div>
      </header>

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
              attention?: boolean;
              idle?: boolean;
            }[] = [
              { label: 'ready', value: total((c) => c.board.ready) },
              {
                label: 'blocked',
                value: total((c) => c.board.blocked),
                attention: total((c) => c.board.blocked) > 0,
              },
              {
                label: 'needs you',
                value: total((c) => c.pendingDecideCount),
                attention: total((c) => c.pendingDecideCount) > 0,
              },
              { label: 'agents running', value: total((c) => c.berthsRunning) },
              {
                label: 'spend today',
                value: `$${total((c) => Math.round(c.spendTodayUsd * 100) / 100).toFixed(2)}`,
              },
            ];
            return readings.map((r) => (
              <div
                key={r.label}
                className={`readout${r.attention ? ' readout--attention' : ''}${
                  r.value === 0 ? ' readout--idle' : ''
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

interface NewProjectFormProps {
  mode: ProjectMode;
  onCancel: () => void;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
}

function NewProjectForm({ mode, onCancel, onSubmit }: NewProjectFormProps) {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  // W12-41: `new` asks for a NAME and nothing else. The server creates that
  // directory (`fs.mkdir` + `ensureGitRepo`) and resolves where it goes, so
  // asking the user to type an absolute path was asking them to dictate a
  // location for something that did not exist yet. `onboard`/`import` are the
  // opposite case: the directory is already there and only the user knows
  // where, so they still ask (a picker is W12-42).
  const derivesPath = mode === 'new';
  const [showLocation, setShowLocation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await onSubmit({
        // Omitted entirely when derived — sending '' would read as "the user
        // chose the empty path" rather than "the user did not choose".
        ...(derivesPath && !showLocation ? {} : { path }),
        name: name.trim() || undefined,
        mode,
      });
    } catch (err) {
      setFormError(errorMessage(err, 'Failed to register project'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="fleet__form"
      onSubmit={(e) => void handleSubmit(e)}
      aria-label={MODE_LABEL[mode]}
    >
      <h2>{MODE_LABEL[mode]}</h2>
      {derivesPath ? (
        <>
          <label>
            Project name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My App"
              required
              autoFocus
            />
          </label>
          {showLocation ? (
            <label>
              Folder
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/Users/you/Code/my-app"
                required
              />
            </label>
          ) : (
            <p className="fleet__form-hint">
              A folder is created for you and set up as a git repository. To put it
              somewhere specific instead,{' '}
              <button
                type="button"
                className="btn-quiet"
                onClick={() => setShowLocation(true)}
              >
                choose the location
              </button>
              .
            </p>
          )}
        </>
      ) : (
        <>
          <label>
            Directory path
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/Users/you/Code/existing-repo"
              required
              autoFocus
            />
          </label>
          {/* W12-42: the input above asks a person to recall an absolute path
              exactly. The picker is the answer for the common case; the input
              stays for the case where the path is already on the clipboard. */}
          <DirectoryPicker value={path} onChange={setPath} />
          <label>
            Name (optional)
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        </>
      )}
      {formError && <p role="alert">{formError}</p>}
      <div className="fleet__form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? 'Working…' : SUBMIT_LABEL[mode]}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
