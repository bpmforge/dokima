/**
 * The "Receipts" tab content: gate/close/waiver receipt list + inspector.
 * Split out of `ArtifactViewer.tsx` (this ticket's AC4 file-size split).
 */

import { EmptyState } from './EmptyState.js';
import { ReceiptInspector } from './ReceiptInspector.js';
import type { ReceiptRecord } from './types.js';

export interface ArtifactReceiptsPaneProps {
  receipts: ReceiptRecord[];
  selectedReceipt: ReceiptRecord | null;
  onSelectReceipt: (id: string) => void;
}

export function ArtifactReceiptsPane({
  receipts,
  selectedReceipt,
  onSelectReceipt,
}: ArtifactReceiptsPaneProps) {
  if (receipts.length === 0 && !selectedReceipt) {
    return <EmptyState copy="No gates have run yet." />;
  }
  return (
    <>
      <ul className="artifact-viewer__list">
        {receipts.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onSelectReceipt(r.id)}>
              {r.kind} · {r.ticketId ?? `phase ${r.phase ?? '—'}`} · {r.createdAt}
            </button>
          </li>
        ))}
      </ul>
      {selectedReceipt && <ReceiptInspector receipt={selectedReceipt} />}
    </>
  );
}
