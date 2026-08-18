import { useTheme } from '../theme/ThemeProvider.js';
import type { View } from './navigation.js';

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {/* W12-33: an inline SVG, not an emoji. Emoji render differently per
          platform and font — next to text buttons they read as a placeholder
          nobody replaced — and their colour is outside our control, so they
          ignore the theme they are supposed to be toggling. `aria-hidden`
          because the button already carries a descriptive `aria-label`. */}
      <svg
        className="icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        {theme === 'dark' ? (
          <path d="M20 13.5A8 8 0 0 1 10.5 4a7 7 0 1 0 9.5 9.5Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
          </>
        )}
      </svg>
      <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
  );
}

/**
 * Where you can go, in one list, rendered the same everywhere (W13-01).
 *
 * `view: null` is the workspace itself — a real destination, which is what
 * lets "← Back" disappear: you return to the board by choosing the board,
 * the same way you reach anywhere else, rather than by a control whose
 * meaning depends on where you happen to be.
 */
const DESTINATIONS: ReadonlyArray<{
  readonly label: string;
  readonly view: View;
  readonly needsProject: boolean;
}> = [
  // `view: null` is "the main surface", which is the Fleet with no project
  // open and the project's board with one. It is always offered, and the label
  // says which it currently is — the first draft of this list made it
  // project-only, which left someone standing on the Roster with no project
  // open and NO destination back to the Fleet. Three e2e specs caught it.
  { label: 'Describe', view: 'interview', needsProject: true },
  { label: 'Plan', view: 'plans', needsProject: true },
  { label: 'Decisions', view: 'decisions', needsProject: true },
  { label: 'Roster', view: 'roster', needsProject: false },
];

interface AppHeaderProps {
  appName: string;
  view: View;
  projectId: string | null;
  decideBadgeCount: number;
  openView: (next: Exclude<View, null>) => void;
  closeView: () => void;
}

export function AppHeader({
  appName,
  view,
  projectId,
  decideBadgeCount,
  openView,
  closeView,
}: AppHeaderProps) {
  return (
    <header className="app-shell__header">
      <span>{appName}</span>
      <div className="app-shell__header-actions">
        {/*
          W13-01: THE DESTINATION SET IS STABLE. This used to collapse to a
          single "← Back" the moment any view opened, so the map a user had
          just learned disappeared exactly when they acted on it — and on the
          Describe form, which is nine questions long, the header also scrolled
          away entirely, leaving no way out at all without scrolling back up.
          Both halves of that are why the founder reported "stopping every
          second because it doesn't make sense".

          The current destination is MARKED, never removed. Removing the thing
          you are standing on is what makes a nav feel like it moved.
        */}
        <nav className="app-shell__nav" aria-label="Views">
          <button
            type="button"
            className="app-shell__nav-item"
            aria-current={view === null ? 'page' : undefined}
            onClick={closeView}
          >
            {projectId === null ? 'Fleet' : 'Board'}
          </button>
          {DESTINATIONS.filter((d) => d.needsProject === false || projectId !== null).map(
            (d) => {
              const current = view === d.view;
              return (
                <button
                  key={d.label}
                  type="button"
                  className="app-shell__nav-item"
                  aria-current={current ? 'page' : undefined}
                  onClick={() => (d.view === null ? closeView() : openView(d.view))}
                >
                  {d.label}
                </button>
              );
            },
          )}
        </nav>
        {/* What needs you — its own group, because a count is not a place. */}
        <button
          type="button"
          className="app-shell__notifications-bell"
          onClick={() => openView('notifications')}
          aria-current={view === 'notifications' ? 'page' : undefined}
          aria-label={`Notifications, ${decideBadgeCount} awaiting a decision`}
        >
          <svg
            className="icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
            <path d="M10.5 19a2 2 0 0 0 3 0" />
          </svg>
          {decideBadgeCount > 0 && (
            <span className="app-shell__decide-badge" data-testid="decide-badge">
              {decideBadgeCount}
            </span>
          )}
        </button>
        {/* W12-29: header chrome recedes. Navigation is reachable, not
            competing with the page's actual action. */}
        <button
          type="button"
          className="btn-quiet"
          onClick={() => openView('settings')}
        >
          Settings
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
