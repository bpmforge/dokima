/**
 * The Fleet's cold-start screen — a first impression, not a fallback
 * (W12-29). Chapter of `FleetHome.tsx`, split at the 400-line
 * CODE_BOOK_PROTOCOL cap when W13-58 made setup the named, primary first
 * step: on a fresh install nothing works until models exist, and the novice
 * audit's critical finding was that nothing on this screen said setup exists.
 */

interface EmptyStateProps {
  archived: boolean;
  onNewProduct: () => void;
  onOnboard: () => void;
  onOpenGuidedSample: () => void;
}

/** UX_SPEC §2b empty-states table. */
export function EmptyState({
  archived,
  onNewProduct,
  onOnboard,
  onOpenGuidedSample,
}: EmptyStateProps) {
  if (archived) {
    return <p className="fleet__empty">No archived projects.</p>;
  }
  return (
    <div className="fleet__empty empty-state" data-testid="fleet-empty">
      {/* W12-29: an empty state is a first impression, not a fallback. The
          captured frame showed "No programs yet." over four identical pills
          and 85% white space — nothing said what this product is for.
          LABELS ARE DELIBERATELY UNCHANGED HERE: renaming them is a
          vocabulary decision (W12-32, which has to pick one word for the
          Fleet/programs/Product/project tangle), and doing it inside a
          hierarchy ticket broke a test that asserts one of those labels. */}
      <p className="empty-state__lead">
        Describe what you want built. Dokima interviews you, writes the plan,
        and works the board with expert agents — on your machine, on your
        models.
      </p>
      {/* W13-58 (novice audit, CRITICAL): nothing on the cold-start screen
          said setup exists, and its only entry wore the label "Try the guided
          sample" — a bait-and-switch into four setup steps. On a fresh
          install setup IS the first step, so it is named, primary, and honest
          about where it leads. */}
      <div className="empty-state__actions">
        <button type="button" className="btn-primary" onClick={onOpenGuidedSample}>
          Set up Dokima
        </button>
        <button type="button" className="btn-secondary" onClick={onNewProduct}>
          New project
        </button>
        <button type="button" className="btn-quiet" onClick={onOnboard}>
          Onboard existing repo
        </button>
      </div>
      <p className="empty-state__hint">
        Setup asks a few questions — which of your models does the work — and
        ends with an optional guided sample project you can watch run.
      </p>
    </div>
  );
}
