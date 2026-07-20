/**
 * R-H1's fixed 3×6 comparison grid: `TECHNICAL_OPTION_LABELS`
 * (Minimal/Clean/Pragmatic) as columns, `DESIGN_DIMENSIONS` (time,
 * maintainability, scalability, team-fit, risk, reversibility) as rows.
 * Column headers double as the choice control (radio per option), matching
 * `decideSlate`'s `labelForChoice` for a technical slate: the chosen value
 * is the option's `label`, not an index.
 */

import { DESIGN_DIMENSIONS, type TechnicalSlate } from './types.js';

export interface TechnicalSlateGridProps {
  slate: TechnicalSlate;
  groupName: string;
  selected: string | null;
  onSelect: (label: string) => void;
  disabled: boolean;
}

export function TechnicalSlateGrid({
  slate,
  groupName,
  selected,
  onSelect,
  disabled,
}: TechnicalSlateGridProps) {
  return (
    <div className="technical-slate-grid">
      <table>
        <thead>
          <tr>
            <th scope="col">Dimension</th>
            {slate.options.map((option) => (
              <th scope="col" key={option.label}>
                <label
                  className={
                    option.label === selected
                      ? 'technical-slate-grid__option technical-slate-grid__option--selected'
                      : 'technical-slate-grid__option'
                  }
                >
                  <input
                    type="radio"
                    name={groupName}
                    value={option.label}
                    checked={option.label === selected}
                    disabled={disabled}
                    onChange={() => onSelect(option.label)}
                  />
                  {option.label}
                  {option.label === slate.recommendedLabel && (
                    <span className="slate-card__badge">Recommended</span>
                  )}
                </label>
                <p className="technical-slate-grid__summary">{option.summary}</p>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DESIGN_DIMENSIONS.map((dimension) => (
            <tr key={dimension}>
              <th scope="row">{dimension}</th>
              {slate.options.map((option) => (
                <td key={option.label}>{option.dimensions[dimension]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="technical-slate-grid__constraint">
        Recommended: <strong>{slate.recommendedLabel}</strong> —{' '}
        {slate.recommendedConstraint}
      </p>
    </div>
  );
}
