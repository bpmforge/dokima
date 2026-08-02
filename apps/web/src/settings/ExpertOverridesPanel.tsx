import { useState } from 'react';
import { useSettingsList } from './useSettingsList.js';
import type { ExpertOverride } from './types.js';

export interface ExpertOverridesPanelProps {
  projectId: string;
}

/** Expert overrides/additions (FR-E1, AC2, G-19): project-local markdown either overriding a core content/experts/** entry by id, or adding a new one — content/experts is data, imported by loaders, never by code imports (this only registers file references). */
export function ExpertOverridesPanel({ projectId }: ExpertOverridesPanelProps) {
  const { items, error, save } = useSettingsList<ExpertOverride>(
    projectId,
    'expertOverrides',
  );
  const [draft, setDraft] = useState({ id: '', name: '', path: '', overrides: false });

  if (!items) {
    return error ? (
      <p role="alert" className="settings__error">
        {error}
      </p>
    ) : (
      <p>Loading…</p>
    );
  }

  const handleAdd = () => {
    if (!draft.id.trim() || !draft.name.trim() || !draft.path.trim()) return;
    void save([
      ...items,
      {
        id: draft.id.trim(),
        name: draft.name.trim(),
        path: draft.path.trim(),
        overrides: draft.overrides,
      },
    ]);
    setDraft({ id: '', name: '', path: '', overrides: false });
  };

  const handleRemove = (id: string) => {
    void save(items.filter((e) => e.id !== id));
  };

  return (
    <section aria-label="Expert Overrides" data-testid="expert-overrides-panel">
      <p className="settings__hint">
        A project-level expert loads without core changes; matching a core expert's id
        overrides it, otherwise it's a pure addition, dispatchable via HANDOFF (FR-E1).
      </p>
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      <ul className="settings__list">
        {items.map((entry) => (
          <li key={entry.id} data-testid="expert-override-row">
            <strong>{entry.name}</strong> ({entry.id}) — <code>{entry.path}</code>{' '}
            {entry.overrides ? (
              <span className="settings__badge settings__badge--warn">
                overrides core
              </span>
            ) : (
              <span className="settings__badge">addition</span>
            )}
            <button type="button" onClick={() => handleRemove(entry.id)}>
              Remove
            </button>
          </li>
        ))}
        {items.length === 0 && <li>No project-level expert overrides yet.</li>}
      </ul>
      <form
        className="settings__row-form"
        aria-label="Add expert override"
        onSubmit={(e) => {
          e.preventDefault();
          handleAdd();
        }}
      >
        <label>
          Id
          <input
            value={draft.id}
            onChange={(e) => setDraft({ ...draft, id: e.target.value })}
          />
        </label>
        <label>
          Name
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          Project-local markdown path
          <input
            value={draft.path}
            onChange={(e) => setDraft({ ...draft, path: e.target.value })}
            placeholder=".dokima/experts/my-expert.md"
          />
        </label>
        <label className="settings__checkbox">
          <input
            type="checkbox"
            checked={draft.overrides}
            onChange={(e) => setDraft({ ...draft, overrides: e.target.checked })}
          />
          Overrides a core expert sharing this id
        </label>
        <button type="submit">Add</button>
      </form>
    </section>
  );
}
