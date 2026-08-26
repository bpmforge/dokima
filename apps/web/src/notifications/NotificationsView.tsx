import { useEffect, useState } from 'react';
import { fetchProjects } from '../fleet/api.js';
import type { ProjectCard } from '../fleet/types.js';
import { MorningQueue } from './MorningQueue.js';
import { NotificationCenter } from './NotificationCenter.js';
import './notifications.css';

type Tab = 'queue' | 'center';

/**
 * UX_SPEC §2/§7 + FR-F4: "the aggregated inbox lives [at Fleet home] too:
 * the cross-project morning queue and notification center." Reachable
 * independent of whichever project happens to be open (App.tsx's `?view=`
 * toggle, same pattern as the Roster screen) — aggregated across every
 * registered project by default, with the per-project filter FR-F4 also
 * names.
 */
export function NotificationsView() {
  const [tab, setTab] = useState<Tab>('queue');
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [projectFilter, setProjectFilter] = useState('');

  useEffect(() => {
    fetchProjects({ archived: false })
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const projectId = projectFilter || undefined;

  return (
    <div className="page notifications-view" data-testid="notifications-view">
      <header className="notifications-view__header">
        <nav className="notifications-view__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'queue'}
            onClick={() => setTab('queue')}
          >
            Morning queue
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'center'}
            onClick={() => setTab('center')}
          >
            All notifications
          </button>
        </nav>
        <label className="notifications-view__project-filter">
          Project
          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            data-testid="notifications-project-filter"
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      {tab === 'queue' ? (
        <MorningQueue projectId={projectId} />
      ) : (
        <NotificationCenter projectId={projectId} />
      )}
    </div>
  );
}
