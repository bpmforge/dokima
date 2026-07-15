import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  archiveProject as archiveProjectRequest,
  createProject as createProjectRequest,
  fetchProjects,
  FleetApiError,
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

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof FleetApiError ? err.message : fallback;
}

export interface FleetHomeProps {
  onOpenProject: (id: string) => void;
}

export function FleetHome({ onOpenProject }: FleetHomeProps) {
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
          <button type="button" onClick={() => setFormMode('new')}>
            New Product
          </button>
          <button type="button" onClick={() => setFormMode('onboard')}>
            Onboard existing repo
          </button>
          <button type="button" onClick={() => setFormMode('import')}>
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

      {!loading && sorted.length === 0 ? (
        <EmptyState
          archived={archivedFilter}
          onNewProduct={() => setFormMode('new')}
          onOnboard={() => setFormMode('onboard')}
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
          {submitting ? 'Working…' : MODE_LABEL[mode]}
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
}

/** UX_SPEC §2b empty-states table. */
function EmptyState({ archived, onNewProduct, onOnboard }: EmptyStateProps) {
  if (archived) {
    return <p className="fleet__empty">No archived programs.</p>;
  }
  return (
    <div className="fleet__empty" data-testid="fleet-empty">
      <p>No programs yet.</p>
      <div className="fleet__actions">
        <button type="button" onClick={onNewProduct}>
          New Product
        </button>
        <button type="button" onClick={onOnboard}>
          Onboard existing repo
        </button>
      </div>
    </div>
  );
}
