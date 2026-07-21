/**
 * Structured field-report form (BLUEPRINT §12.6, UX_SPEC §7 G-10c): what
 * happened, what was expected, evidence links — pre-filled from
 * `initialDraft` (built by `prefill.ts` from a trace or escalation event)
 * but always editable before the filer submits.
 */
import { type FormEvent, useState } from 'react';
import type { FieldReportDraft } from './types.js';

export interface FieldReportFormProps {
  initialDraft: FieldReportDraft;
  onSubmit: (draft: FieldReportDraft) => void | Promise<void>;
  onCancel?: () => void;
  submitting: boolean;
  error?: string | null;
}

export function FieldReportForm({
  initialDraft,
  onSubmit,
  onCancel,
  submitting,
  error,
}: FieldReportFormProps) {
  const [whatHappened, setWhatHappened] = useState(initialDraft.whatHappened);
  const [expected, setExpected] = useState(initialDraft.expected);
  const [evidenceLinks, setEvidenceLinks] = useState<string[]>(
    initialDraft.evidenceLinks,
  );
  const [newLink, setNewLink] = useState('');

  const addLink = () => {
    const trimmed = newLink.trim();
    if (!trimmed) return;
    setEvidenceLinks((prev) => [...prev, trimmed]);
    setNewLink('');
  };

  const removeLink = (link: string) => {
    setEvidenceLinks((prev) => prev.filter((l) => l !== link));
  };

  const canSubmit = whatHappened.trim() !== '' && expected.trim() !== '' && !submitting;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    void onSubmit({
      ...initialDraft,
      whatHappened: whatHappened.trim(),
      expected: expected.trim(),
      evidenceLinks,
    });
  };

  return (
    <form className="field-report-form" data-testid="field-report-form" onSubmit={submit}>
      {initialDraft.sourceRef && (
        <p className="field-report-form__source" data-testid="field-report-form-source">
          Filed from {initialDraft.source}: {initialDraft.sourceRef}
        </p>
      )}
      <label className="field-report-form__field">
        What happened
        <textarea
          aria-label="What happened"
          value={whatHappened}
          disabled={submitting}
          onChange={(e) => setWhatHappened(e.target.value)}
          required
        />
      </label>
      <label className="field-report-form__field">
        What you expected
        <textarea
          aria-label="What you expected"
          value={expected}
          disabled={submitting}
          onChange={(e) => setExpected(e.target.value)}
          required
        />
      </label>
      <fieldset className="field-report-form__evidence">
        <legend>Evidence links</legend>
        <ul data-testid="field-report-form-evidence-list">
          {evidenceLinks.map((link) => (
            <li key={link}>
              {link}
              <button
                type="button"
                aria-label={`Remove evidence link ${link}`}
                disabled={submitting}
                onClick={() => removeLink(link)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <input
          aria-label="Add evidence link"
          value={newLink}
          disabled={submitting}
          onChange={(e) => setNewLink(e.target.value)}
        />
        <button type="button" disabled={submitting} onClick={addLink}>
          Add
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div className="field-report-form__actions">
        <button type="submit" disabled={!canSubmit}>
          {submitting ? 'Filing…' : 'File field report'}
        </button>
        {onCancel && (
          <button type="button" disabled={submitting} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
