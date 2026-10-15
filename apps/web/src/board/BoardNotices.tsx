/**
 * Board notices that stand in for the run controls or the board itself.
 * Split out of BoardView.tsx to keep each file under the 400-line cap.
 */
import type { MouseEvent } from 'react';

/** Why nothing can build yet, as the person reads it — providers first, then models. */
export const NO_MODEL_REASON =
  'Nothing can build yet: no model is set up for the coding agent. Add a provider in Settings → Providers, then pick a model in Settings → Models.';

/**
 * Opens Settings in-app. A real href keeps middle-click and "copy link"
 * working; the click itself pushes the URL and lets the app's popstate
 * listener (App/navigation.ts — the URL is the source of truth) switch view.
 */
function openSettingsLink(event: MouseEvent<HTMLAnchorElement>) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  window.history.pushState({}, '', event.currentTarget.href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** The reason runs are disabled, with a way to the fix. */
export function NoModelReason({ projectId }: { projectId: string }) {
  return (
    <p id="board-run-blocked-reason" data-testid="board-run-blocked-reason">
      {NO_MODEL_REASON}{' '}
      <a
        href={`?project=${encodeURIComponent(projectId)}&view=settings`}
        onClick={openSettingsLink}
        data-testid="board-run-open-providers"
      >
        Open Settings → Providers
      </a>
    </p>
  );
}

/**
 * Review R6: a failed read is not an empty project. Showing onboarding here
 * told a person with a server problem that their board was empty.
 */
export function BoardLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="board-view" data-testid="board-view-load-error">
      <p role="alert" className="board-view__load-error">
        Couldn&apos;t load the board: {message}
      </p>
      <button type="button" className="btn-quiet" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
