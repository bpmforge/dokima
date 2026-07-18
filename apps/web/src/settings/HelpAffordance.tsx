import { useCallback, useState } from 'react';
import { fetchGuideTopic } from './api-rules.js';

export interface HelpAffordanceProps {
  topic: string;
  label: string;
}

/** In-product help affordance rendered from content/guide/ (R-M1): a "?" that opens task-oriented help. content/guide/ has no content yet (content-lane gap, see guide-routes.ts) — degrades to an honest "no guide yet" state rather than fabricating text. */
export function HelpAffordance({ topic, label }: HelpAffordanceProps) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState<string | null | undefined>(undefined);

  const handleOpen = useCallback(async () => {
    setOpen(true);
    if (markdown !== undefined) return;
    try {
      const guide = await fetchGuideTopic(topic);
      setMarkdown(guide.markdown);
    } catch {
      setMarkdown(null);
    }
  }, [markdown, topic]);

  return (
    <span className="settings__help">
      <button
        type="button"
        aria-label={`Help: ${label}`}
        className="settings__help-button"
        onClick={() => void handleOpen()}
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="settings__help-popover"
          data-testid="help-popover"
        >
          {markdown === undefined ? (
            'Loading…'
          ) : markdown === null ? (
            'No guide written yet for this topic.'
          ) : (
            <pre>{markdown}</pre>
          )}
          <button type="button" onClick={() => setOpen(false)}>
            Close
          </button>
        </span>
      )}
    </span>
  );
}
