import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  archiveProject as archiveProjectRequest,
  createProject as createProjectRequest,
  fetchProjects,
  FleetApiError,
  removeProject as removeProjectRequest,
} from './api.js';
import { ProjectCard } from './ProjectCard.js';
import { sortByAttention } from './sort.js';
import type {
  CreateProjectInput,
  ProjectCard as ProjectCardData,
  ProjectMode,
} from './types.js';
import './fleet.css';

/** Live-update substitute (FR-F1's WS push is deferred — see HANDOFF in plan.json). */
const POLL_INTERVAL_MS = 5_000;

const MODE_LABEL: Record<ProjectMode, string> = {
  new: 'New Product',
  onboard: 'Onboard existing repo',
  import: 'Import',
};

/** The commit action needs its own verb — MODE_LABEL alone reads as a noun-phrase mode name, not something a button press does. */
const SUBMIT_LABEL: Record<ProjectMode, string> = {
  new: 'Create New Product',
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
      await createProjectRequest(input);
      setFormMode(null);
      await refresh();
    },
    [refresh],
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

  const handleReopen = useCallback(
    async (projectPath: string) => {
      await createProjectRequest({ path: projectPath, mode: 'import' });
      await refresh();
    },
    [refresh],
  );

  return (
    <div className="fleet" data-testid="fleet-home">
      <header className="fleet__header">
        <h1>Fleet</h1>
        <div className="fleet__actions">
          {/* W12-29: one primary per screen. New Product is what a person
              came to Fleet to do; the rest are real actions that should not
              compete with it. */}
          <button
            type="button"
            className="btn-primary"
            onClick={() => setFormMode('new')}
          >
            New Product
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
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await onSubmit({ path, name: name.trim() || undefined, mode });
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
      <label>
        Directory path
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          required
          autoFocus
        />
      </label>
      <label>
        Name (optional)
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
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

interface EmptyStateProps {
  archived: boolean;
  onNewProduct: () => void;
  onOnboard: () => void;
  onOpenGuidedSample: () => void;
}

/** UX_SPEC §2b empty-states table. */
function EmptyState({
  archived,
  onNewProduct,
  onOnboard,
  onOpenGuidedSample,
}: EmptyStateProps) {
  if (archived) {
    return <p className="fleet__empty">No archived projects.</p>;
  }
  return (
    <div className="fleet__empty empty-state" data-testid="fleet-empty">
      {/* W12-29: an empty state is a first impression, not a fallback. The
          captured frame showed "No programs yet." over four identical pills
          and 85% white space — nothing said what this product is for.
          LABELS ARE DELIBERATELY UNCHANGED HERE: renaming them is a
          vocabulary decision (W12-32, which has to pick one word for the
          Fleet/programs/Product/project tangle), and doing it inside a
          hierarchy ticket broke a test that asserts one of those labels. */}
      <p className="empty-state__lead">
        Describe what you want built. Dokima interviews you, writes the plan,
        and works the board with expert agents — on your machine, on your
        models.
      </p>
      <div className="empty-state__actions">
        {/* Secondary, not primary: the header's New Product is the persistent
            action and owns the single primary slot. Two blue buttons labelled
            the same thing is worse than none. */}
        <button type="button" className="btn-secondary" onClick={onNewProduct}>
          New Product
        </button>
        <button type="button" className="btn-secondary" onClick={onOnboard}>
          Onboard existing repo
        </button>
        <button type="button" className="btn-quiet" onClick={onOpenGuidedSample}>
          Try the guided sample
        </button>
      </div>
    </div>
  );
}
