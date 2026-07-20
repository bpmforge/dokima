/**
 * Founder-owned fork slate: 2–4 free-form options with trade-offs and one
 * `recommendedId` marked Recommended (FR-P6, BLUEPRINT §"Decision slates").
 */

import type { FounderSlate } from './types.js';

export interface FounderSlateOptionsProps {
  slate: FounderSlate;
  groupName: string;
  selected: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
}

export function FounderSlateOptions({
  slate,
  groupName,
  selected,
  onSelect,
  disabled,
}: FounderSlateOptionsProps) {
  return (
    <div className="founder-slate-options">
      <ul className="founder-slate-options__list" role="list">
        {slate.options.map((option) => (
          <li key={option.id}>
            <label
              className={
                option.id === selected
                  ? 'founder-slate-options__option founder-slate-options__option--selected'
                  : 'founder-slate-options__option'
              }
            >
              <input
                type="radio"
                name={groupName}
                value={option.id}
                checked={option.id === selected}
                disabled={disabled}
                onChange={() => onSelect(option.id)}
              />
              <span className="founder-slate-options__label">
                {option.label}
                {option.id === slate.recommendedId && (
                  <span className="slate-card__badge">Recommended</span>
                )}
              </span>
            </label>
            <p className="founder-slate-options__tradeoffs">{option.tradeoffs}</p>
          </li>
        ))}
      </ul>
      <p className="founder-slate-options__reasoning">{slate.recommendedReasoning}</p>
    </div>
  );
}
