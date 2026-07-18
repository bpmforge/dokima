/**
 * Optional code-search client (UX_SPEC §2a: "queries the W7-06 code index
 * when present"; SRS FR-M4: "W4 command palette queries the same index").
 * W7-06 (`packages/memory/src/code-index/**`) is still `todo` — no
 * `code_search` HTTP route exists anywhere in `apps/server` yet, and this
 * ticket doesn't own `packages/memory/**` to add one. `/code-search` below
 * is this consumer's expected shape (a project-scoped GET, query + ranked
 * file:line chunks — the natural REST mirror of FR-M4's
 * `code_search(query, top_k, path_filter)`); until W7-06 registers it,
 * every call 404s and this degrades to "absent" exactly like the receipts
 * routes' honest-empty approvals ledger (C-1) — never a fabricated result.
 */

export interface CodeSearchHit {
  path: string;
  line: number;
  snippet: string;
}

export interface CodeIndexApiOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

/** `null` means "index not present / not reachable" — distinct from an empty result set. */
export async function queryCodeIndex(
  projectId: string,
  query: string,
  opts: CodeIndexApiOptions = {},
): Promise<CodeSearchHit[] | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(
      `${opts.baseUrl ?? ''}/api/v1/projects/${encodeURIComponent(projectId)}/code-search?q=${encodeURIComponent(query)}`,
      {
        headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: CodeSearchHit[] };
    return Array.isArray(body.items) ? body.items : null;
  } catch {
    return null;
  }
}
