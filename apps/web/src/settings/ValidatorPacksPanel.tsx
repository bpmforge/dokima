import { useState } from 'react';
import { useSettingsList } from './useSettingsList.js';

export interface ValidatorPacksPanelProps {
  projectId: string;
}

/** Validator-pack selection (FR-S1, AC2, G-19): the project-scope `select` list packages/validators/src/pack.ts's `loadValidatorPack()` consumes to narrow content/validators/** to a per-project subset. */
export function ValidatorPacksPanel({ projectId }: ValidatorPacksPanelProps) {
  const { items, error, save } = useSettingsList<string>(
    projectId,
    'validatorPackSelection',
  );
  const [draft, setDraft] = useState('');

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
    const name = draft.trim();
    if (!name || items.includes(name)) return;
    void save([...items, name]);
    setDraft('');
  };

  const handleRemove = (name: string) => {
    void save(items.filter((n) => n !== name));
  };

  return (
    <section aria-label="Validator Packs" data-testid="validator-packs-panel">
      <p className="settings__hint">
        Empty selection means the full pack under <code>content/validators/</code> runs.
        Naming an unknown validator here is refused at load time with the exact name shown
        (<code>UnknownValidatorSelectionError</code>).
      </p>
      {error && (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      <ul className="settings__list">
        {items.map((name) => (
          <li key={name} data-testid="validator-pack-row">
            {name}
            <button type="button" onClick={() => handleRemove(name)}>
              Remove
            </button>
          </li>
        ))}
        {items.length === 0 && <li>Full pack selected (no restriction).</li>}
      </ul>
      <form
        className="settings__row-form"
        aria-label="Add validator to selection"
        onSubmit={(e) => {
          e.preventDefault();
          handleAdd();
        }}
      >
        <label>
          Validator name
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="validate-file-size"
          />
        </label>
        <button type="submit">Add to selection</button>
      </form>
    </section>
  );
}
