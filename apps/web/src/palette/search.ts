import type { ArtifactListItem } from '../artifacts/types.js';
import type { BoardTicket } from '../board/types.js';
import type { ReceiptRecord } from '../artifacts/types.js';
import type {
  PaletteDocResult,
  PaletteReceiptResult,
  PaletteResult,
  PaletteTicketResult,
} from './types.js';

const MAX_RESULTS_PER_KIND = 8;

function matches(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.toLowerCase());
}

/**
 * Exact/prefix id matches first (the common "jump to W2-04" case), then
 * title substring matches, each in original order — a simple, deterministic
 * ranking rather than a fuzzy scorer (no library, no false-positive noise).
 */
function rank<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => [string, string],
): T[] {
  if (query.trim().length === 0) return [];
  const idExact: T[] = [];
  const idPrefix: T[] = [];
  const titleMatch: T[] = [];
  for (const item of items) {
    const [id, title] = text(item);
    if (id.toLowerCase() === query.toLowerCase()) idExact.push(item);
    else if (id.toLowerCase().startsWith(query.toLowerCase())) idPrefix.push(item);
    else if (matches(title, query) || matches(id, query)) titleMatch.push(item);
  }
  return [...idExact, ...idPrefix, ...titleMatch].slice(0, MAX_RESULTS_PER_KIND);
}

export function searchTickets(
  tickets: readonly BoardTicket[],
  query: string,
): PaletteTicketResult[] {
  return rank(tickets, query, (t) => [t.id, t.title]).map((t) => ({
    kind: 'ticket',
    id: t.id,
    title: t.title,
    status: t.status,
    lane: t.lane,
  }));
}

export function searchDocs(
  docs: readonly ArtifactListItem[],
  query: string,
): PaletteDocResult[] {
  return rank(docs, query, (d) => [d.path, d.title]).map((d) => ({
    kind: 'doc',
    path: d.path,
    title: d.title,
  }));
}

export function searchReceipts(
  receipts: readonly ReceiptRecord[],
  query: string,
): PaletteReceiptResult[] {
  return rank(receipts, query, (r) => [r.id, r.kind]).map((r) => ({
    kind: 'receipt',
    id: r.id,
    title: `${r.kind} · ${r.ticketId ?? 'project-level'} · ${r.createdAt}`,
  }));
}

export function resultKey(result: PaletteResult): string {
  return result.kind === 'doc' ? `doc:${result.path}` : `${result.kind}:${result.id}`;
}
