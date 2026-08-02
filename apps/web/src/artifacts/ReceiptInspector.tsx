/**
 * Receipt Inspector (FR-C5, UX_SPEC §5): "any gate receipt, coverage
 * report, challenge report, or ledger row opens as a structured view
 * (validator table with exit codes and gap counts, input hash, timestamps,
 * signer) — raw JSON one toggle away." Coverage payloads are duck-typed
 * (`units`/`counts` shape) rather than imported from `@dokima/loop` —
 * `apps/web` may only import *types* from `@dokima/shared`
 * (ARCHITECTURE.md §4), never another package directly.
 */

import { useState } from 'react';
import type { ReceiptRecord } from './types.js';

const COVERAGE_STATUSES = [
  'DONE',
  'WAIVED',
  'BLOCKED',
  'FAILED',
  'SKIPPED',
  'PENDING',
  'RUNNING',
];

interface CoverageUnitLike {
  spec: { id: string; description: string };
  status: string;
  waiver?: { by: string; reason: string } | null;
}

interface CoveragePayloadLike {
  units: CoverageUnitLike[];
  counts: Record<string, number>;
}

function isCoveragePayload(payload: unknown): payload is CoveragePayloadLike {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    Array.isArray((payload as CoveragePayloadLike).units) &&
    typeof (payload as CoveragePayloadLike).counts === 'object'
  );
}

function CoverageGrid({ payload }: { payload: CoveragePayloadLike }) {
  return (
    <div className="receipt-coverage">
      <div className="receipt-coverage__counts">
        {COVERAGE_STATUSES.filter((s) => payload.counts[s]).map((status) => (
          <span
            key={status}
            className={`receipt-coverage__count receipt-coverage__count--${status.toLowerCase()}`}
          >
            {status}: {payload.counts[status]}
          </span>
        ))}
      </div>
      <table className="receipt-coverage__table">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Status</th>
            <th>Waiver</th>
          </tr>
        </thead>
        <tbody>
          {payload.units.map((unit) => (
            <tr key={unit.spec.id} data-testid={`coverage-unit-${unit.spec.id}`}>
              <td>{unit.spec.description}</td>
              <td
                className={
                  unit.status === 'SKIPPED' ? 'receipt-coverage__skipped' : undefined
                }
              >
                {unit.status}
              </td>
              <td>{unit.waiver ? `${unit.waiver.by}: ${unit.waiver.reason}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReceiptInspector({ receipt }: { receipt: ReceiptRecord }) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="receipt-inspector" data-testid="receipt-inspector">
      <dl className="receipt-inspector__fields">
        <dt>Kind</dt>
        <dd>{receipt.kind}</dd>
        <dt>Ticket</dt>
        <dd>{receipt.ticketId ?? '—'}</dd>
        <dt>Phase</dt>
        <dd>{receipt.phase ?? '—'}</dd>
        <dt>Input tree hash</dt>
        <dd className="receipt-inspector__hash">{receipt.inputTreeHash}</dd>
        <dt>Verify command</dt>
        <dd>{receipt.verifyCommand ?? '—'}</dd>
        <dt>Verify exit</dt>
        <dd>{receipt.verifyExit ?? '—'}</dd>
        <dt>Signed by</dt>
        <dd>{receipt.signedBy ?? '—'}</dd>
        <dt>Created</dt>
        <dd>{receipt.createdAt}</dd>
      </dl>

      <table className="receipt-inspector__validators">
        <thead>
          <tr>
            <th>Validator</th>
            <th>Exit code</th>
            <th>Gap count</th>
          </tr>
        </thead>
        <tbody>
          {receipt.validators.map((v) => (
            <tr key={v.name}>
              <td>{v.name}</td>
              <td
                className={
                  v.exitCode !== 0 ? 'receipt-inspector__exit-nonzero' : undefined
                }
              >
                {v.exitCode}
              </td>
              <td>{v.gapCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {receipt.kind === 'coverage' && isCoveragePayload(receipt.payload) && (
        <CoverageGrid payload={receipt.payload} />
      )}

      <button type="button" onClick={() => setShowRaw((v) => !v)}>
        {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
      </button>
      {showRaw && (
        <pre className="receipt-inspector__raw">{JSON.stringify(receipt, null, 2)}</pre>
      )}
    </div>
  );
}
