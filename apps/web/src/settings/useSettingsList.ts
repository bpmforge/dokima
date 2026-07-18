import { useCallback, useEffect, useState } from 'react';
import { fetchProjectSettings, putProjectSettings, SettingsApiError } from './api.js';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SettingsApiError ? err.message : fallback;
}

/** Shared list-editor state for a project-settings key that stores an array (MCP servers, validator pack selection, expert overrides) — AC2's "not just the model matrix" settings surfaces are all thin editors over the same generic three-scope key/value store (scope-routes.ts). */
export function useSettingsList<T>(projectId: string, key: string) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const settings = await fetchProjectSettings(projectId);
      const value = settings[key];
      setItems(Array.isArray(value) ? (value as T[]) : []);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, `Failed to load ${key}`));
    }
  }, [projectId, key]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (next: T[]) => {
      try {
        await putProjectSettings(projectId, { [key]: next });
        setItems(next);
        setError(null);
      } catch (err) {
        setError(errorMessage(err, `Failed to save ${key}`));
      }
    },
    [projectId, key],
  );

  return { items, error, save };
}
