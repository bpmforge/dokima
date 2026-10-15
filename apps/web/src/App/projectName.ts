import { useEffect, useState } from 'react';
import { fetchProjects } from '../fleet/api.js';

/**
 * The open project's display name, so the header and the tab title say which
 * project you are in. Null while loading, or if the lookup fails.
 */
export function useProjectName(projectId: string | null): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    setName(null);
    if (!projectId) return;
    let cancelled = false;
    fetchProjects()
      .then((projects) => {
        if (!cancelled) setName(projects.find((p) => p.id === projectId)?.name ?? null);
      })
      .catch(() => {
        if (!cancelled) setName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    document.title = name ? `${name} · Dokima` : 'Dokima';
  }, [name]);

  return name;
}
