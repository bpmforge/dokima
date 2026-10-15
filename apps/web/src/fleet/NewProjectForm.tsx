/**
 * The New project / Onboard / Import form on the Fleet (split out of
 * FleetHome.tsx to keep each file under the 400-line cap).
 */
import { type FormEvent, useState } from 'react';
import { FleetApiError } from './api.js';
import { DirectoryPicker } from './DirectoryPicker.js';
import type { CreateProjectInput, ProjectMode } from './types.js';

export const MODE_LABEL: Record<ProjectMode, string> = {
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

export interface NewProjectFormProps {
  mode: ProjectMode;
  onCancel: () => void;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
}

export function NewProjectForm({ mode, onCancel, onSubmit }: NewProjectFormProps) {
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
    // `required` lets a name of only spaces through; say so on the field
    // rather than sending it and showing the server's wire wording.
    if (derivesPath && !showLocation && name.trim() === '') {
      setFormError('Give the project a name.');
      return;
    }
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
