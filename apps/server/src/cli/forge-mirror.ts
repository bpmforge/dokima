/**
 * cli/forge-mirror.ts — the Forge Mirror, composed (W16-04, FR-T5/SC-15,
 * BLUEPRINT §3.4 "the Jira-grade guarantee, without Jira").
 *
 * `packages/forge/src/mirror/*` (write-through, offline queue,
 * reconciliation anchors) existed complete behind an unexported barrel and
 * apps/server did not even declare `@dokima/forge`. This chapter is the
 * composition the mirror's own HANDOFF notes asked for: the land loop's
 * injected `verbMirror` seam (harbormaster stays forge-free per the
 * ARCHITECTURE §4 matrix) maps each lifecycle verb onto `attemptOrQueue`,
 * and the run start drains whatever a previous offline run left queued.
 *
 * Durable queue home: the append-only event log — `forge.mirror_queued` /
 * `forge.mirror_flushed` events keyed by a per-entry id (C-6: the log IS
 * the audit substrate; DATABASE.md §3's ticket-history note predates this
 * wiring and the deviation is recorded on the W16-04 board entry).
 *
 * Law 8: the settings value carries vault REF NAMES for tokens, resolved
 * through the run's vault — a credential-shaped raw value is refused
 * without being echoed (the W14-02 posture). A missing/disabled setting is
 * the normal local-first state: no mirror, no noise. A malformed one
 * disables the mirror for the run with a NAMED note (FR-G5 — degrade
 * honestly, never silently), never kills the run.
 */
import { appendEvent, getReceipt, listEvents, type EventLog } from '@dokima/events';
import {
  attemptOrQueue,
  createGiteaForgeAdapter,
  createGitHubForgeAdapter,
  flushMirrorQueue,
  type ForgeAdapter,
  type MirrorCloseReceiptSummary,
  type MirrorWriteRequest,
  type QueuedMirrorWrite,
  type RepoRef,
} from '@dokima/forge';
import type { LandVerbEvent, LandVerbMirror } from '@dokima/harbormaster';

export const FORGE_MIRROR_SETTINGS_KEY = 'forgeMirror';
const CLAIM_LABEL = 'dokima:claimed';

export interface ForgeMirrorConfig {
  readonly kind: 'gitea' | 'github';
  /** Required for gitea; ignored for github (its API base is fixed). */
  readonly baseUrl?: string;
  readonly owner: string;
  readonly repo: string;
  /** Vault ref NAMES (law 8) — never raw tokens. */
  readonly makerTokenRef: string;
  readonly makerLogin: string;
}

export type ParsedForgeMirrorSetting =
  | { readonly config: ForgeMirrorConfig }
  | { readonly disabled: true }
  | { readonly refusal: string };

/** Parses the `forgeMirror` setting. Absent = disabled (local-first normal). */
export function parseForgeMirrorSetting(
  raw: unknown,
  isSecretShaped: (value: string) => boolean,
): ParsedForgeMirrorSetting {
  if (raw === undefined || raw === null) return { disabled: true };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { refusal: `${FORGE_MIRROR_SETTINGS_KEY} must be an object` };
  }
  const v = raw as Record<string, unknown>;
  if (v.kind !== 'gitea' && v.kind !== 'github') {
    return { refusal: `${FORGE_MIRROR_SETTINGS_KEY}.kind must be "gitea" or "github"` };
  }
  for (const key of ['owner', 'repo', 'makerTokenRef', 'makerLogin'] as const) {
    if (typeof v[key] !== 'string' || v[key] === '') {
      return {
        refusal: `${FORGE_MIRROR_SETTINGS_KEY}.${key} must be a non-empty string`,
      };
    }
  }
  if (v.kind === 'gitea' && (typeof v.baseUrl !== 'string' || v.baseUrl === '')) {
    return { refusal: `${FORGE_MIRROR_SETTINGS_KEY}.baseUrl is required for gitea` };
  }
  // Law 8: the ref field must NAME a vault secret, never carry one. Refused
  // without echoing the value.
  if (isSecretShaped(v.makerTokenRef as string)) {
    return {
      refusal:
        `${FORGE_MIRROR_SETTINGS_KEY}.makerTokenRef looks like a raw credential — ` +
        `store the token in the vault and put its NAME here (law 8)`,
    };
  }
  return {
    config: {
      kind: v.kind,
      ...(typeof v.baseUrl === 'string' ? { baseUrl: v.baseUrl } : {}),
      owner: v.owner as string,
      repo: v.repo as string,
      makerTokenRef: v.makerTokenRef as string,
      makerLogin: v.makerLogin as string,
    },
  };
}

interface QueuedEventPayload {
  readonly entryId: string;
  readonly entry: QueuedMirrorWrite;
}

function entryId(ticketId: string, verb: string, queuedAt: string): string {
  return `${ticketId}:${verb}:${queuedAt}`;
}

/** Queued-minus-flushed, in queue order — the durable queue, replayed from the log. */
export function pendingMirrorQueue(
  log: EventLog,
): readonly { entryId: string; entry: QueuedMirrorWrite }[] {
  const flushedIds = new Set<string>();
  const queued: { entryId: string; entry: QueuedMirrorWrite }[] = [];
  for (const event of listEvents(log)) {
    if (event.eventType === 'forge.mirror_flushed') {
      flushedIds.add((event.payload as { entryId: string }).entryId);
    } else if (event.eventType === 'forge.mirror_queued') {
      const payload = event.payload as QueuedEventPayload;
      queued.push({ entryId: payload.entryId, entry: payload.entry });
    }
  }
  return queued.filter((q) => !flushedIds.has(q.entryId));
}

export interface ComposeForgeMirrorOptions {
  readonly log: EventLog;
  readonly actorId: string;
  readonly runId: string;
  readonly config: ForgeMirrorConfig;
  /** Vault resolution (law 8). */
  readonly resolveSecret: (
    name: string,
  ) => string | undefined | Promise<string | undefined>;
  readonly secretValues: readonly string[];
  readonly stderr: (line: string) => void;
  readonly now?: () => string;
  /** Test seam — production builds the real adapter from `config`. */
  readonly adapter?: ForgeAdapter;
}

export interface ComposedForgeMirror {
  readonly verbMirror: LandVerbMirror;
  /** Drains queued writes from prior offline runs — call once at run start (reconciliation's cheap half). */
  flushPending(): Promise<void>;
}

/**
 * Builds the live mirror, or explains (once, honestly) why there is none.
 * Never throws for config/credential problems — a broken mirror must not
 * block a land (FR-G5); it reports and steps aside.
 */
export async function composeForgeMirror(
  options: ComposeForgeMirrorOptions,
): Promise<ComposedForgeMirror | undefined> {
  const { config } = options;
  const now = options.now ?? (() => new Date().toISOString());
  let adapter = options.adapter;
  if (!adapter) {
    const makerToken = await options.resolveSecret(config.makerTokenRef);
    if (!makerToken) {
      options.stderr(
        `${options.runId}: forge mirror disabled — vault has no secret named ` +
          `"${config.makerTokenRef}". Landed tickets still land; the forge just ` +
          `won't hear about them this run.`,
      );
      return undefined;
    }
    adapter =
      config.kind === 'gitea'
        ? createGiteaForgeAdapter({ baseUrl: config.baseUrl!, makerToken })
        : createGitHubForgeAdapter({ makerToken });
  }
  const boundAdapter = adapter;
  const ref: RepoRef = { owner: config.owner, repo: config.repo };

  const record = (eventType: string, payload: unknown, ticketId?: string) => {
    appendEvent(
      options.log,
      { eventType, actorId: options.actorId, ticketId: ticketId ?? null, payload },
      { secretValues: [...options.secretValues] },
    );
  };

  /** ticketId -> mirrored issue number, replayed from the log; created on first verb. */
  const issueFor = async (ticketId: string, title: string): Promise<number> => {
    for (const event of listEvents(options.log)) {
      if (event.eventType !== 'forge.issue_mapped') continue;
      const payload = event.payload as { ticketId: string; issueNumber: number };
      if (payload.ticketId === ticketId) return payload.issueNumber;
    }
    const issue = await boundAdapter.createIssue(
      ref,
      {
        title: `${ticketId}: ${title}`,
        body: `Mirrored from Dokima ticket ${ticketId}.`,
      },
      'maker',
    );
    record('forge.issue_mapped', { ticketId, issueNumber: issue.number }, ticketId);
    return issue.number;
  };

  const requestFor = (event: LandVerbEvent): MirrorWriteRequest => {
    if (event.kind === 'claim') {
      return {
        verb: 'claim',
        assigneeLogin: config.makerLogin,
        label: CLAIM_LABEL,
      };
    }
    if (event.kind === 'evidence') {
      return { verb: 'evidence', body: event.body ?? '(no evidence body)' };
    }
    return { verb: 'close', receipt: closeSummaryFor(options, event, now) };
  };

  return {
    verbMirror: {
      onVerb: async (event) => {
        const issueNumber = await issueFor(event.ticketId, event.ticketTitle);
        const request = requestFor(event);
        const outcome = await attemptOrQueue(
          boundAdapter,
          ref,
          issueNumber,
          request,
          [],
          now,
        );
        if (outcome.result) {
          record(
            'forge.mirror_written',
            { verb: event.kind, issueNumber },
            event.ticketId,
          );
          return;
        }
        const entry = outcome.queue[outcome.queue.length - 1]!;
        record(
          'forge.mirror_queued',
          { entryId: entryId(event.ticketId, event.kind, entry.queuedAt), entry },
          event.ticketId,
        );
        options.stderr(
          `${options.runId}: forge unreachable — ${event.kind} for ${event.ticketId} ` +
            `queued; it will flush on the next run that can reach the forge.`,
        );
      },
    },
    flushPending: async () => {
      const pending = pendingMirrorQueue(options.log);
      if (pending.length === 0) return;
      const outcome = await flushMirrorQueue(
        boundAdapter,
        ref,
        pending.map((p) => p.entry),
      );
      for (const flushed of outcome.flushed) {
        const match = pending.find((p) => p.entry === flushed.entry);
        if (match) record('forge.mirror_flushed', { entryId: match.entryId });
      }
      if (outcome.remaining.length > 0) {
        options.stderr(
          `${options.runId}: forge still unreachable — ${outcome.remaining.length} ` +
            `mirror write(s) stay queued.`,
        );
      }
    },
  };
}

/** The close receipt's mirror summary, from the REAL minted receipt (SC-15's non-spoofable anchor derives from these fields). */
function closeSummaryFor(
  options: ComposeForgeMirrorOptions,
  event: LandVerbEvent,
  now: () => string,
): MirrorCloseReceiptSummary {
  const receipt = event.receiptId ? getReceipt(options.log, event.receiptId) : null;
  return {
    ticketId: event.ticketId,
    ownerId: options.actorId,
    verifyCommand: receipt?.verifyCommand ?? '(unknown)',
    verifyExitCode: receipt?.verifyExit ?? 0,
    commits: [...(event.commits ?? [])],
    files: [],
    mintedAt: receipt?.createdAt ?? now(),
  };
}

export interface SetupForgeMirrorOptions {
  readonly log: EventLog;
  readonly actorId: string;
  readonly runId: string;
  /** The raw `forgeMirror` setting value, already scope-resolved by the caller. */
  readonly settingRaw: unknown;
  readonly isSecretShaped: (value: string) => boolean;
  readonly resolveSecret: (
    name: string,
  ) => string | undefined | Promise<string | undefined>;
  readonly secretValues: readonly string[];
  readonly stderr: (line: string) => void;
  readonly adapter?: ForgeAdapter;
  readonly now?: () => string;
}

/**
 * The one-call composition `run-build.ts` uses: parse the setting, compose
 * the mirror, drain the offline queue from prior runs. Config problems
 * disable the mirror with a named note (FR-G5) — never a thrown error, so
 * a broken mirror can never stop a run from landing work.
 */
export async function setupForgeMirror(
  options: SetupForgeMirrorOptions,
): Promise<ComposedForgeMirror | undefined> {
  const parsed = parseForgeMirrorSetting(options.settingRaw, options.isSecretShaped);
  if ('disabled' in parsed) return undefined;
  if ('refusal' in parsed) {
    options.stderr(
      `${options.runId}: forge mirror disabled — ${parsed.refusal}. Landed ` +
        `tickets still land; fix the setting to mirror them.`,
    );
    return undefined;
  }
  const mirror = await composeForgeMirror({
    log: options.log,
    actorId: options.actorId,
    runId: options.runId,
    config: parsed.config,
    resolveSecret: options.resolveSecret,
    secretValues: options.secretValues,
    stderr: options.stderr,
    ...(options.adapter ? { adapter: options.adapter } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  // Reconciliation's cheap half: whatever a previous offline run queued
  // flushes now, in order, before this run writes anything new.
  await mirror?.flushPending();
  return mirror;
}
