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
      {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
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
                <button type="button" onClick={() => openView('plans')}>
                  Plan
                </button>
              )}
              <button
                type="button"
                className="app-shell__notifications-bell"
                onClick={() => openView('notifications')}
                aria-label={`Notifications, ${decideBadgeCount} awaiting a decision`}
              >
                🔔
                {decideBadgeCount > 0 && (
                  <span className="app-shell__decide-badge" data-testid="decide-badge">
                    {decideBadgeCount}
                  </span>
                )}
              </button>
            </>
          )}
        </nav>
        <button type="button" onClick={() => openView('settings')}>
          Settings
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
