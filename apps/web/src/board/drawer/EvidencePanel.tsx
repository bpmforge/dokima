import { useEffect, useState } from 'react';
import { fetchReceipts } from '../../artifacts/api.js';
import { ReceiptInspector } from '../../artifacts/ReceiptInspector.js';
import type { ReceiptRecord } from '../../artifacts/types.js';
import type { ContractTicket } from './types.js';

export interface EvidencePanelProps {
  baseUrl: string;
  token: string;
  projectId: string;
  ticket: ContractTicket;
}

/**
 * Evidence (UX_SPEC §4): the manifest/close-receipt summary plus every
 * durable receipt on file for this ticket, each openable as a full
 * `ReceiptInspector` (imported read-only from `artifacts/**`, out of this
 * ticket's write_scope — same precedent as the palette's doc/receipt
 * jump-to).
 */
export function EvidencePanel({ baseUrl, token, projectId, ticket }: EvidencePanelProps) {
  const [receipts, setReceipts] = useState<ReceiptRecord[] | null>(null);
  const [openReceipt, setOpenReceipt] = useState<ReceiptRecord | null>(null);

  useEffect(() => {
    setReceipts(null);
    setOpenReceipt(null);
    void fetchReceipts(
      projectId,
      { ticket: ticket.id },
      { baseUrl, getToken: () => token },
    ).then(setReceipts);
  }, [baseUrl, token, projectId, ticket.id]);

  return (
    <section aria-label="Evidence" data-testid="drawer-evidence">
      {ticket.manifest ? (
        <dl className="ticket-drawer__contract-grid">
          <dt>Verify</dt>
          <dd>
            <code>{ticket.manifest.verify.command}</code> → exit{' '}
            {ticket.manifest.verify.exitCode}
          </dd>
          <dt>Files</dt>
          <dd>{ticket.manifest.files.length}</dd>
          <dt>Commits</dt>
          <dd>{ticket.manifest.commits.join(', ') || 'none'}</dd>
          <dt>Close receipt minted</dt>
          <dd>{ticket.manifest.closeReceipt.mintedAt}</dd>
        </dl>
      ) : (
        <p className="ticket-drawer__empty">No manifest yet.</p>
      )}

      <h3>Receipts</h3>
      {openReceipt ? (
        <>
          <button type="button" onClick={() => setOpenReceipt(null)}>
            ← Back to receipts
          </button>
          <ReceiptInspector receipt={openReceipt} />
        </>
      ) : receipts === null ? (
        <p>Loading receipts…</p>
      ) : receipts.length === 0 ? (
        <p className="ticket-drawer__empty">No gates have run yet.</p>
      ) : (
        <ul data-testid="drawer-receipts-list">
          {receipts.map((receipt) => (
            <li key={receipt.id}>
              <button type="button" onClick={() => setOpenReceipt(receipt)}>
                {receipt.kind} · {receipt.createdAt}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
