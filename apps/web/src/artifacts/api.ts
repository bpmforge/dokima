/**
 * Artifact Viewer + Receipt Inspector REST client
 * (`apps/server/src/api/server/{artifacts,receipts}-routes.ts`). Mirrors
 * `apps/web/src/fleet/api.ts`'s fetch/error/token-injection shape rather
 * than importing it — sibling feature folders stay self-contained so this
 * ticket's write_scope (`apps/web/src/artifacts/**`) never has to reach
 * into `fleet/**` (same pattern `chat/api.ts` established for W4-04).
 */

import type {
  ArtifactComment,
  ArtifactDiff,
  ArtifactDoc,
  ArtifactDocDiff,
  ArtifactListItem,
  ApprovalLedgerRow,
  CreateCommentInput,
  ReceiptRecord,
} from './types.js';

export class ArtifactApiError extends Error {
  constructor(
    public readonly status: number,
    detail?: string,
  ) {
    super(detail ?? `Artifact API request failed with status ${status}`);
    this.name = 'ArtifactApiError';
  }
}

export function readInjectedToken(): string | undefined {
  return (globalThis as { __SHIPWRIGHT_TOKEN__?: string }).__SHIPWRIGHT_TOKEN__;
}

export interface ArtifactApiOptions {
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined;
  baseUrl?: string;
}

async function request(
  urlPath: string,
  init: RequestInit,
  opts: ArtifactApiOptions,
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const getToken = opts.getToken ?? readInjectedToken;
  const token = getToken();
  const res = await fetchImpl(`${opts.baseUrl ?? ''}${urlPath}`, {
    ...init,
    headers: {
      ...init.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => undefined);
    const detail =
      typeof body === 'object' && body !== null && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : undefined;
    throw new ArtifactApiError(res.status, detail);
  }
  if (res.status === 204) return undefined;
  return res.json();
}

export async function fetchArtifactList(
  projectId: string,
  opts: ArtifactApiOptions = {},
): Promise<ArtifactListItem[]> {
  const body = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/artifacts`,
    { method: 'GET' },
    opts,
  )) as { items: ArtifactListItem[] };
  return body.items;
}

export async function fetchArtifactDoc(
  projectId: string,
  filePath: string,
  rev: string | undefined,
  opts: ArtifactApiOptions = {},
): Promise<ArtifactDoc> {
  const qs = new URLSearchParams({ path: filePath });
  if (rev) qs.set('rev', rev);
  return (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/artifacts/doc?${qs.toString()}`,
    { method: 'GET' },
    opts,
  )) as ArtifactDoc;
}

export async function fetchArtifactDiff(
  projectId: string,
  filePath: string,
  ticket: string,
  opts: ArtifactApiOptions = {},
): Promise<ArtifactDiff> {
  const qs = new URLSearchParams({ path: filePath, ticket });
  return (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/artifacts/diff?${qs.toString()}`,
    { method: 'GET' },
    opts,
  )) as ArtifactDiff;
}

/** Diffs one path across two arbitrary revisions directly (FR-C8: revised version vs. the commented version). */
export async function fetchArtifactDocDiff(
  projectId: string,
  filePath: string,
  from: string,
  to: string | undefined,
  opts: ArtifactApiOptions = {},
): Promise<ArtifactDocDiff> {
  const qs = new URLSearchParams({ path: filePath, from });
  if (to) qs.set('to', to);
  return (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/artifacts/doc-diff?${qs.toString()}`,
    { method: 'GET' },
    opts,
  )) as ArtifactDocDiff;
}

export async function fetchArtifactComments(
  projectId: string,
  filePath: string,
  opts: ArtifactApiOptions = {},
): Promise<ArtifactComment[]> {
  const qs = new URLSearchParams({ path: filePath });
  const body = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/artifacts/comments?${qs.toString()}`,
    { method: 'GET' },
    opts,
  )) as { items: ArtifactComment[] };
  return body.items;
}

export async function postArtifactComment(
  projectId: string,
  input: CreateCommentInput,
  opts: ArtifactApiOptions = {},
): Promise<{ comment: ArtifactComment; revisionRequested: boolean }> {
  return (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/artifacts/comments`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    opts,
  )) as { comment: ArtifactComment; revisionRequested: boolean };
}

export async function fetchReceipt(
  projectId: string,
  receiptId: string,
  opts: ArtifactApiOptions = {},
): Promise<ReceiptRecord> {
  const wire = (await request(
    `/api/v1/receipts/${encodeURIComponent(receiptId)}?project=${encodeURIComponent(projectId)}`,
    { method: 'GET' },
    opts,
  )) as ReceiptWire;
  return fromReceiptWire(wire);
}

export async function fetchReceipts(
  projectId: string,
  filter: { kind?: string; ticket?: string } = {},
  opts: ArtifactApiOptions = {},
): Promise<ReceiptRecord[]> {
  const qs = new URLSearchParams();
  if (filter.kind) qs.set('kind', filter.kind);
  if (filter.ticket) qs.set('ticket', filter.ticket);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const body = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/receipts${suffix}`,
    { method: 'GET' },
    opts,
  )) as { items: ReceiptWire[] };
  return body.items.map(fromReceiptWire);
}

export async function fetchApprovalsLedger(
  projectId: string,
  opts: ArtifactApiOptions = {},
): Promise<ApprovalLedgerRow[]> {
  const body = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/approvals-ledger`,
    { method: 'GET' },
    opts,
  )) as { items: ApprovalLedgerRow[] };
  return body.items;
}

interface ReceiptWire {
  id: string;
  kind: ReceiptRecord['kind'];
  project_id: string;
  phase: number | null;
  ticket_id: string | null;
  validators: ReceiptRecord['validators'];
  input_tree_hash: string;
  verify_command: string | null;
  verify_exit: number | null;
  signed_by: string | null;
  payload: unknown;
  created_at: string;
}

function fromReceiptWire(wire: ReceiptWire): ReceiptRecord {
  return {
    id: wire.id,
    kind: wire.kind,
    projectId: wire.project_id,
    phase: wire.phase,
    ticketId: wire.ticket_id,
    validators: wire.validators,
    inputTreeHash: wire.input_tree_hash,
    verifyCommand: wire.verify_command,
    verifyExit: wire.verify_exit,
    signedBy: wire.signed_by,
    payload: wire.payload,
    createdAt: wire.created_at,
  };
}
