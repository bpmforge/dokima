/**
 * Per-member settings (W20-06, D-029) — each org member's own knobs.
 *
 * Three things belong to a member rather than to the project: which model does
 * their work, how far their ladder may climb, and how many turns their
 * sessions start with. All three write through the settings APIs that already
 * exist; this drawer only scopes them to one member.
 *
 * The escalation copy is D-029 verbatim in spirit: `ask` DEFERS. The attempt in
 * flight keeps running on its current rung and the approval arrives through the
 * queue — an overnight run can never hang mid-ladder waiting for a person.
 */
import { useState } from 'react';

export type EscalationMode = 'ladder' | 'ask' | 'locked';

export interface MemberSettingsValue {
  readonly model?: string;
  readonly escalation: EscalationMode;
  readonly maxToolIterations?: number;
}

export interface MemberSettingsProps {
  readonly displayName: string;
  readonly value: MemberSettingsValue;
  readonly onSave: (next: MemberSettingsValue) => void | Promise<void>;
}

const MODE_COPY: Record<EscalationMode, string> = {
  ladder:
    'Climbs on its own when work stalls — cheapest model first, one step at a time.',
  ask: 'Keeps working on the current model and asks you before climbing. Nothing pauses while it waits.',
  locked: 'Never climbs. Retries the same model, then parks with its evidence.',
};

export function MemberSettings({ displayName, value, onSave }: MemberSettingsProps) {
  const [escalation, setEscalation] = useState<EscalationMode>(value.escalation);
  const [turns, setTurns] = useState<string>(
    value.maxToolIterations === undefined ? '' : String(value.maxToolIterations),
  );
  const [saved, setSaved] = useState(false);

  return (
    <section className="team__settings" data-testid="member-settings">
      <h4>{displayName}&rsquo;s settings</h4>

      <fieldset className="team__settings-group">
        <legend>When work stalls</legend>
        {(['ladder', 'ask', 'locked'] as const).map((mode) => (
          <label key={mode} className="settings__radio">
            <input
              type="radio"
              name={`escalation-${displayName}`}
              value={mode}
              checked={escalation === mode}
              data-testid={`escalation-${mode}`}
              onChange={() => {
                setEscalation(mode);
                setSaved(false);
              }}
            />
            <span>
              <b>
                {mode === 'ladder'
                  ? 'Climb on its own'
                  : mode === 'ask'
                    ? 'Ask me first'
                    : 'Stay on this model'}
              </b>
              <span className="team__settings-hint">{MODE_COPY[mode]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="team__settings-turns">
        Turn budget
        <input
          type="number"
          min={1}
          value={turns}
          placeholder="12 (default)"
          data-testid="member-turns"
          onChange={(e) => {
            setTurns(e.target.value);
            setSaved(false);
          }}
        />
      </label>

      <button
        type="button"
        className="btn-primary"
        data-testid="member-settings-save"
        onClick={() => {
          const parsed = Number(turns);
          void onSave({
            ...(value.model === undefined ? {} : { model: value.model }),
            escalation,
            ...(turns !== '' && Number.isFinite(parsed) && parsed > 0
              ? { maxToolIterations: parsed }
              : {}),
          });
          setSaved(true);
        }}
      >
        Save {displayName}&rsquo;s settings
      </button>
      {saved && (
        <p className="team__settings-saved" role="status" data-testid="member-settings-saved">
          Saved. This changes {displayName} only — everyone else keeps what they had.
        </p>
      )}
    </section>
  );
}
