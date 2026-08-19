/**
 * DirectoryPicker — say WHERE without typing an absolute path (W12-42).
 *
 * `new` no longer asks for a path at all (W12-41): the server creates the
 * directory. `onboard` and `import` are the opposite case — the directory
 * already exists and its location is information only the user has. The field
 * that asked for it was a bare text input with a placeholder of somebody
 * else's path, which asks a person to recall an absolute path exactly.
 *
 * A hosted web app could not fix this: `<input type="file">` yields contents
 * and a fake path, `webkitdirectory` yields relative ones. Dokima's core is a
 * local process on the same machine, so it can `readdir` — see
 * `browse-routes.ts` for the bounded-roots decision that makes it safe.
 *
 * The text input STAYS, underneath. Browsing is better for the common case
 * and worse for the case where someone already has the path on their
 * clipboard, and a picker that forbids pasting would be a new kind of
 * annoying. This is an addition, not a replacement.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  browseDirectory,
  fetchBrowseRoots,
  FleetApiError,
  type BrowseEntry,
  type BrowseListing,
  type BrowseRoot,
  type FleetApiOptions,
} from './api.js';

export interface DirectoryPickerProps {
  /** The currently chosen directory, or '' when nothing is chosen yet. */
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly apiOptions?: FleetApiOptions;
}

export function DirectoryPicker({ value, onChange, apiOptions = {} }: DirectoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [roots, setRoots] = useState<BrowseRoot[]>([]);
  const [listing, setListing] = useState<BrowseListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const go = useCallback(
    async (target: string) => {
      setLoading(true);
      setError(null);
      try {
        setListing(await browseDirectory(target, apiOptions));
      } catch (err) {
        // Named, not swallowed: the server distinguishes a missing directory
        // from an unreadable one from one outside the allowed roots, and each
        // is a different thing for the user to do next. Collapsing them into
        // "could not open" throws away the only useful part.
        setError(
          err instanceof FleetApiError ? err.message : 'Could not read that directory.',
        );
        setListing(null);
      } finally {
        setLoading(false);
      }
    },
    // Intentionally empty: `apiOptions` is a literal from the caller and a
    // new identity every render, so depending on it would rebuild `go` on
    // every keystroke in the surrounding form.
    [],
  );

  useEffect(() => {
    if (!open || roots.length > 0) return;
    void (async () => {
      try {
        const found = await fetchBrowseRoots(apiOptions);
        setRoots(found);
        if (found[0]) await go(found[0].path);
      } catch (err) {
        setError(err instanceof FleetApiError ? err.message : 'Could not list your folders.');
      }
    })();
    // Keyed on `open` alone: this fetches the roots once, the first time the
    // picker is opened, and `roots.length > 0` above makes a re-open a no-op.
  }, [open]);

  if (!open) {
    return (
      <button type="button" className="picker__open" onClick={() => setOpen(true)}>
        Browse…
      </button>
    );
  }

  const choose = (entry: BrowseEntry | string) => {
    onChange(typeof entry === 'string' ? entry : entry.path);
    setOpen(false);
  };

  return (
    <div className="surface picker" role="group" aria-label="Choose a directory">
      <div className="picker__roots">
        {roots.map((root) => (
          <button
            key={root.path}
            type="button"
            className="picker__root"
            onClick={() => void go(root.path)}
          >
            {root.label}
          </button>
        ))}
      </div>

      {listing && (
        <p className="picker__here">
          {listing.parent && (
            <button
              type="button"
              className="picker__up"
              onClick={() => void go(listing.parent as string)}
            >
              Up
            </button>
          )}
          <code>{listing.path}</code>
        </p>
      )}

      {loading && <p className="picker__loading">Reading…</p>}
      {error && (
        <p role="alert" className="picker__error">
          {error}
        </p>
      )}

      {listing && !loading && (
        <ul className="picker__list">
          {listing.entries.length === 0 && (
            <li className="picker__empty">No folders in here.</li>
          )}
          {listing.entries.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                className="picker__entry"
                onClick={() => void go(entry.path)}
              >
                {entry.name}
              </button>
              {/* Already in the fleet: offering it for onboard is a dead end,
                  and the server would refuse it after the user committed. */}
              {entry.registered ? (
                <span className="picker__taken">already open</span>
              ) : (
                <button
                  type="button"
                  className="picker__choose"
                  onClick={() => choose(entry)}
                >
                  Use this
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="picker__actions">
        {listing && (
          <button type="button" onClick={() => choose(listing.path)}>
            Use {listing.path.split('/').pop() || listing.path}
          </button>
        )}
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>

      {value && <p className="picker__chosen">Chosen: {value}</p>}
    </div>
  );
}
