import type { SpendByRung as SpendByRungData } from './types.js';

export interface SpendByRungProps {
  data: SpendByRungData | null;
}

/**
 * "Spend by rung" (UX_SPEC §4). A plain data table, not a chart — WCAG 2.2
 * AA (UX_SPEC §9 "spend charts have data-table twins"): simplest to just
 * *be* the table rather than build a chart plus a twin. Today `items` is
 * always empty (no spend ledger migration yet — `estimate-routes.ts`'s
 * module header); this renders that honestly rather than inventing rows.
 */
export function SpendByRung({ data }: SpendByRungProps) {
  if (!data) return <p>Loading spend…</p>;
  if (data.items.length === 0) {
    return (
      <p className="ticket-drawer__empty" data-testid="spend-by-rung-empty">
        No spend recorded yet for this project — costs appear here, grouped by rung, as runs call models.
      </p>
    );
  }
  return (
    <table className="ticket-drawer__spend-table" data-testid="spend-by-rung-table">
      <caption className="sr-only">Spend by rung</caption>
      <thead>
        <tr>
          <th scope="col">Rung</th>
          <th scope="col">Amount (USD)</th>
        </tr>
      </thead>
      <tbody>
        {data.items.map((row) => (
          <tr key={row.rung}>
            <td>{row.rung}</td>
            <td>${row.amount_usd.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
