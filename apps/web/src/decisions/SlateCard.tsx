/**
 * One decision slate. Open slates render the FR-P6 choose form (founder
 * free-form options or the R-H1 technical 3×6 grid); a decided slate
 * reflects the recorded choice + D-ID instead (this ticket's acceptance:
 * "choosing an option ... reflects the recorded decision").
 */

import { useState } from 'react';
import { FounderSlateOptions } from './FounderSlateOptions.js';
import { TechnicalSlateGrid } from './TechnicalSlateGrid.js';
import type { SlateRecord } from './types.js';

export interface SlateCardProps {
  record: SlateRecord;
  onDecide: (chosen: string, rationale: string) => void | Promise<void>;
  deciding: boolean;
  error: string | null;
}

function chosenDisplayLabel(record: SlateRecord): string {
  const { slate, chosen } = record;
  if (!chosen) return '';
  if (slate.kind === 'founder') {
    return slate.options.find((o) => o.id === chosen)?.label ?? chosen;
  }
  return chosen;
}

export function SlateCard({ record, onDecide, deciding, error }: SlateCardProps) {
  const { slate } = record;
  const [selected, setSelected] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  const groupName = `slate-${record.id}`;

  if (record.status === 'decided') {
    return (
      <div
        className="slate-card slate-card--decided"
        data-testid={`slate-card-${record.id}`}
      >
        <h3>{slate.title}</h3>
        <p className="slate-card__decided-badge">
          Decided{record.d_id ? ` · ${record.d_id}` : ''}
        </p>
        <p className="slate-card__chosen">
          <strong>Chosen:</strong> {chosenDisplayLabel(record)}
        </p>
        {record.rationale && (
          <p className="slate-card__rationale">
            <strong>Rationale:</strong> {record.rationale}
          </p>
        )}
      </div>
    );
  }

  const choose = () => {
    if (!selected) return;
    void onDecide(selected, rationale.trim());
  };

  return (
    <div className="slate-card" data-testid={`slate-card-${record.id}`}>
      <h3>{slate.title}</h3>
      {slate.kind === 'founder' ? (
        <FounderSlateOptions
          slate={slate}
          groupName={groupName}
          selected={selected}
          onSelect={setSelected}
          disabled={deciding}
        />
      ) : (
        <TechnicalSlateGrid
          slate={slate}
          groupName={groupName}
          selected={selected}
          onSelect={setSelected}
          disabled={deciding}
        />
      )}
      <label className="slate-card__rationale-field">
        Rationale (optional)
        <textarea
          aria-label={`Rationale for ${slate.title}`}
          value={rationale}
          disabled={deciding}
          onChange={(e) => setRationale(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={choose} disabled={!selected || deciding}>
        {deciding ? 'Recording…' : 'Choose'}
      </button>
    </div>
  );
}
