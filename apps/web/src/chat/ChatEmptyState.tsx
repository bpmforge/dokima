/**
 * Chat's empty state (UX_SPEC §2b: "every screen has one; write them,
 * don't improvise" — no dedicated Chat row exists in that table, so this
 * follows its sibling rows' tone). Honest, not fabricated: nothing has
 * published to `chat:<project>` yet (no loop/Harbormaster wiring lands
 * until later waves — same "nothing is fabricated" precedent as the
 * board's active-berths strip).
 */
export function ChatEmptyState() {
  return (
    <div className="chat__empty" data-testid="chat-empty-state">
      <p>No agent activity yet.</p>
      <span className="chat__empty-hint">
        Messages, questions, findings, and manifests appear here as agents work.
      </span>
    </div>
  );
}
