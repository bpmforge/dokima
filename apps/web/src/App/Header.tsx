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
        <nav className="app-shell__nav">
          {view && view !== 'settings' && view !== 'wizard' ? (
            <button type="button" onClick={closeView}>
              ← Back
            </button>
          ) : (
            <>
              <button type="button" onClick={() => openView('roster')}>
                Roster
              </button>
              {projectId && (
                <>
                  {/* W10-54: the entry point to describing your own idea. Sits
                      beside Plan because that is where a user looks for "what
                      is this product going to be". */}
                  <button type="button" onClick={() => openView('interview')}>
                    Describe
                  </button>
                  <button type="button" onClick={() => openView('plans')}>
                    Plan
                  </button>
                  {/* W10-72: the Decisions board was unreachable from anywhere
                      in the app, so a run paused on a founder decision had no
                      surface to answer it. */}
                  <button type="button" onClick={() => openView('decisions')}>
                    Decisions
                  </button>
                </>
              )}
              <button
                type="button"
                className="app-shell__notifications-bell"
                onClick={() => openView('notifications')}
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
            </>
          )}
        </nav>
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
