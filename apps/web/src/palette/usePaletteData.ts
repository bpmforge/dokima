import { useEffect, useState } from 'react';
import { fetchArtifactList, fetchReceipts } from '../artifacts/api.js';
import type { ReceiptRecord } from '../artifacts/types.js';
import { fetchBoardTickets } from '../board/api.js';
import type { BoardTicket } from '../board/types.js';
import { fetchProjects } from '../fleet/api.js';
import { queryCodeIndex, type CodeSearchHit } from './codeIndex.js';
import type { NavContext } from './navEntries.js';

export interface PaletteData {
  tickets: BoardTicket[];
  setTickets: React.Dispatch<React.SetStateAction<BoardTicket[]>>;
  docs: { path: string; title: string }[];
  receipts: ReceiptRecord[];
  codeHits: CodeSearchHit[] | null;
  projects: NavContext['projects'];
}

/**
 * Everything the palette searches, fetched when it opens. Project data
 * (tickets, docs, receipts, code) only with a project open and a token; the
 * Fleet list always, so "open a project" works from any screen. A failed
 * fetch leaves that list empty rather than escaping as an unhandled
 * rejection (W10-29).
 */
export function usePaletteData(
  open: boolean,
  query: string,
  baseUrl: string,
  token: string | undefined,
  projectId: string | null,
): PaletteData {
  const [tickets, setTickets] = useState<BoardTicket[]>([]);
  const [docs, setDocs] = useState<{ path: string; title: string }[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [codeHits, setCodeHits] = useState<CodeSearchHit[] | null>(null);
  const [projects, setProjects] = useState<NavContext['projects']>([]);

  useEffect(() => {
    if (!open) return;
    void fetchProjects({}, token ? { getToken: () => token } : {})
      .then(setProjects)
      .catch(() => setProjects([]));
    if (!projectId || !token) {
      setTickets([]);
      setDocs([]);
      setReceipts([]);
      return;
    }
    void fetchBoardTickets({ baseUrl, token }, projectId).then((res) => {
      if (res.ok) setTickets(res.data);
    });
    void fetchArtifactList(projectId, { baseUrl, getToken: () => token })
      .then(setDocs)
      .catch(() => setDocs([]));
    void fetchReceipts(projectId, {}, { baseUrl, getToken: () => token })
      .then(setReceipts)
      .catch(() => setReceipts([]));
  }, [open, baseUrl, token, projectId]);

  useEffect(() => {
    if (!open || !projectId || !token || query.trim().length === 0) {
      setCodeHits(null);
      return;
    }
    let cancelled = false;
    void queryCodeIndex(projectId, query, { baseUrl, token }).then((hits) => {
      if (!cancelled) setCodeHits(hits);
    });
    return () => {
      cancelled = true;
    };
  }, [open, query, baseUrl, token, projectId]);

  return { tickets, setTickets, docs, receipts, codeHits, projects };
}
