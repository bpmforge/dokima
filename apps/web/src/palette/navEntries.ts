import type { PaletteNavResult, PaletteView } from './types.js';

/** At most this many projects are listed before anything is typed. */
const MAX_PROJECTS_UNFILTERED = 8;
const MAX_NAV_RESULTS = 12;

const PROJECT_VIEWS: readonly { view: PaletteView; label: string }[] = [
  { view: 'team', label: 'Team' },
  { view: 'interview', label: 'Describe' },
  { view: 'plans', label: 'Plan' },
  { view: 'decisions', label: 'Decisions' },
  { view: 'lessons', label: 'Lessons' },
];

const GLOBAL_VIEWS: readonly { view: PaletteView; label: string }[] = [
  { view: 'roster', label: 'Roster' },
  { view: 'notifications', label: 'Morning queue' },
  { view: 'settings', label: 'Settings' },
];

export interface NavContext {
  /** The open project, or null on the Fleet / a project-less screen. */
  projectId: string | null;
  /** Fleet projects (non-archived), for "open a project" entries. */
  projects: readonly { id: string; name: string; available: boolean }[];
}

/**
 * Every place the palette can send you from here. The same destinations the
 * header offers (project-scoped views only with a project open), plus one
 * entry per Fleet project. A project whose folder is gone is left out — it
 * has no board to open.
 */
export function paletteNavEntries(context: NavContext): PaletteNavResult[] {
  const entries: PaletteNavResult[] = [
    { kind: 'nav', id: 'fleet', title: 'Go to Fleet', target: { kind: 'fleet' } },
  ];
  if (context.projectId !== null) {
    entries.push({
      kind: 'nav',
      id: 'board',
      title: 'Go to Board',
      target: { kind: 'board' },
    });
    for (const { view, label } of PROJECT_VIEWS) {
      entries.push({
        kind: 'nav',
        id: view,
        title: `Go to ${label}`,
        target: { kind: 'view', view },
      });
    }
  }
  for (const { view, label } of GLOBAL_VIEWS) {
    entries.push({
      kind: 'nav',
      id: view,
      title: `Go to ${label}`,
      target: { kind: 'view', view },
    });
  }
  for (const project of context.projects) {
    if (!project.available || project.id === context.projectId) continue;
    entries.push({
      kind: 'nav',
      id: `project:${project.id}`,
      title: `Open project ${project.name}`,
      target: { kind: 'project', projectId: project.id },
    });
  }
  return entries;
}

/**
 * Filters nav entries by a typed query (case-insensitive substring of the
 * title). With nothing typed every screen is listed but only the first few
 * projects, so a big Fleet does not bury the screens.
 */
export function searchNav(
  entries: readonly PaletteNavResult[],
  query: string,
): PaletteNavResult[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    let projects = 0;
    return entries.filter((e) => {
      if (e.target.kind !== 'project') return true;
      projects += 1;
      return projects <= MAX_PROJECTS_UNFILTERED;
    });
  }
  return entries
    .filter((e) => e.title.toLowerCase().includes(q))
    .slice(0, MAX_NAV_RESULTS);
}
