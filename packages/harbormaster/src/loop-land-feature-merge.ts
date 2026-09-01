/**
 * loop-land-feature-merge.ts — the synthetic-branch engine for per-feature
 * landing (P6-05), a TypeScript port of the bootstrap conductor's
 * `scripts/conductor/wave.mjs` (`buildSyntheticBranch`,
 * `mergeWithMetadataCarveOut`) + `feature-landing.mjs` (`landFeature`)
 * refusal semantics, mirrored exactly:
 *
 * - a CODE conflict on any member refuses the whole feature (no conflict is
 *   ever hand-resolved — resolving one IS feature authorship); a conflict
 *   confined entirely to `metadataPaths` resolves to the BASE's version, and
 *   metadata files are reset to base by construction even when merging clean;
 * - verify re-runs on the SYNTHETIC head (injected); member drift and
 *   base-advanced both refuse; every refusal leaves the base branch untouched
 *   and cleans up the synthetic worktree/branch, keeping the parked member
 *   branches — the tested assets (bootstrap Challenger finding 7);
 * - the landing is ONE `--no-ff` merge, and an unexpected merge failure
 *   aborts rather than leaving the root mid-merge (finding 7b).
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { git, resolveCurrentBranch } from '@dokima/git';
import { appendEvent, type EventLog } from '@dokima/events';
import { commentTicket } from '@dokima/tickets';
import { FEATURE_LANDED_EVENT, type ParkedBranchRecord } from './loop-land-feature.js';

export interface MetadataCarveOutInput {
  /** The tree the merge runs in (the synthetic worktree). */
  readonly cwd: string;
  readonly branch: string;
  readonly message: string;
  readonly metadataPaths: readonly string[];
}

export interface MetadataCarveOutResult {
  readonly merged: boolean;
  /** Conflicting files, only when the merge was refused (aborted). */
  readonly conflictFiles: readonly string[];
}

/**
 * Merge `branch` into `cwd` with ONE deterministic carve-out: a conflict
 * confined entirely to `metadataPaths` resolves to OURS (the base/root
 * version). Any conflict touching a non-metadata file aborts and reports —
 * feature work is NEVER auto-resolved.
 */
export async function mergeWithMetadataCarveOut(
  input: MetadataCarveOutInput,
): Promise<MetadataCarveOutResult> {
  try {
    await git(input.cwd, ['merge', '--no-ff', '-q', '-m', input.message, input.branch]);
    return { merged: true, conflictFiles: [] };
  } catch {
    let conflictFiles: string[] = [];
    try {
      const { stdout } = await git(input.cwd, ['diff', '--name-only', '--diff-filter=U']);
      conflictFiles = stdout.split('\n').filter(Boolean);
    } catch {
      /* diff unavailable — treated as a non-metadata conflict below */
    }
    const meta = new Set(input.metadataPaths);
    if (conflictFiles.length > 0 && conflictFiles.every((f) => meta.has(f))) {
      await git(input.cwd, ['checkout', '--ours', '--', ...conflictFiles]);
      await git(input.cwd, ['add', '--', ...conflictFiles]);
      await git(input.cwd, ['commit', '-q', '--no-edit']);
      return { merged: true, conflictFiles: [] };
    }
    try {
      await git(input.cwd, ['merge', '--abort']);
    } catch {
      /* no in-progress merge to abort */
    }
    return { merged: false, conflictFiles };
  }
}

export interface SyntheticBranchRecord {
  readonly branch: string;
  readonly worktreePath: string;
  readonly headSha: string;
  readonly baseSha: string;
  readonly merged: readonly { readonly ticketId: string; readonly headSha: string }[];
  readonly conflicted: readonly {
    readonly ticketId: string;
    readonly files: readonly string[];
  }[];
  /** Non-null when a member merge left uncommitted state — the substrate is lying; refuse. */
  readonly dirty: string | null;
}

export interface BuildSyntheticBranchInput {
  readonly repoRoot: string;
  readonly baseRef: string;
  readonly featureId: string;
  readonly members: readonly ParkedBranchRecord[];
  readonly metadataPaths: readonly string[];
  /** Defaults to `<repoRoot>/.dokima/worktrees`. */
  readonly worktreesDir?: string;
}

function featureSlug(featureId: string): string {
  return (
    featureId
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'feature'
  );
}

/**
 * Detached worktree at `baseRef`, each member's branch merged in id order.
 * No feature work is ever authored here; the branch is built, gated, and
 * discarded. Metadata files are reset to the base's version by construction
 * — a member whose stale board file merges CLEAN would otherwise carry it
 * onto the base and silently revert other features' rows.
 */
export async function buildSyntheticBranch(
  input: BuildSyntheticBranchInput,
): Promise<SyntheticBranchRecord> {
  const stamp = createHash('sha256')
    .update(input.members.map((m) => `${m.ticketId}@${m.headSha}`).join('|'))
    .digest('hex')
    .slice(0, 8);
  const branch = `wave/feature-${featureSlug(input.featureId)}`;
  const worktreesDir =
    input.worktreesDir ?? path.join(input.repoRoot, '.dokima', 'worktrees');
  const worktreePath = path.join(worktreesDir, `feature-${stamp}`);
  // A prior refused attempt may have leaked either half; clear both first.
  try {
    await git(input.repoRoot, ['worktree', 'remove', '--force', worktreePath]);
  } catch {
    /* none prior */
  }
  await fs.rm(worktreePath, { recursive: true, force: true });
  try {
    await git(input.repoRoot, ['branch', '-D', branch]);
  } catch {
    /* none prior */
  }
  await fs.mkdir(worktreesDir, { recursive: true });
  await git(input.repoRoot, [
    'worktree',
    'add',
    '-q',
    '-b',
    branch,
    worktreePath,
    input.baseRef,
  ]);

  const baseSha = (await git(input.repoRoot, ['rev-parse', input.baseRef])).stdout.trim();
  const merged: { ticketId: string; headSha: string }[] = [];
  const conflicted: { ticketId: string; files: readonly string[] }[] = [];
  let dirty: string | null = null;
  for (const member of [...input.members].sort((a, b) =>
    a.ticketId.localeCompare(b.ticketId),
  )) {
    const result = await mergeWithMetadataCarveOut({
      cwd: worktreePath,
      branch: member.branch,
      message: `wave: ${member.ticketId}`,
      metadataPaths: input.metadataPaths,
    });
    if (!result.merged) {
      conflicted.push({ ticketId: member.ticketId, files: result.conflictFiles });
      continue;
    }
    const status = (await git(worktreePath, ['status', '--porcelain'])).stdout.trim();
    if (status) {
      dirty = `synthetic tree dirty after merging ${member.ticketId}: ${status.split('\n')[0]}`;
      break;
    }
    merged.push({ ticketId: member.ticketId, headSha: member.headSha });
  }
  if (input.metadataPaths.length > 0 && merged.length > 0 && dirty === null) {
    await git(worktreePath, ['checkout', input.baseRef, '--', ...input.metadataPaths]);
    const metaDirty = (await git(worktreePath, ['status', '--porcelain'])).stdout.trim();
    if (metaDirty) {
      await git(worktreePath, ['add', '--', ...input.metadataPaths]);
      await git(worktreePath, [
        'commit',
        '-q',
        '-m',
        `wave: metadata reset to ${input.baseRef} (root board is the truth)`,
      ]);
    }
  }
  const headSha = (await git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
  return { branch, worktreePath, headSha, baseSha, merged, conflicted, dirty };
}

/** A refusal must not leak the synthetic worktree/branch (finding 7). Tolerant throughout. */
export async function cleanupSyntheticBranch(
  repoRoot: string,
  record: Pick<SyntheticBranchRecord, 'branch' | 'worktreePath'>,
): Promise<void> {
  try {
    await git(repoRoot, ['worktree', 'remove', '--force', record.worktreePath]);
  } catch {
    /* best effort */
  }
  await fs.rm(record.worktreePath, { recursive: true, force: true }).catch(() => {});
  try {
    await git(repoRoot, ['branch', '-D', record.branch]);
  } catch {
    /* best effort */
  }
}

export interface SyntheticVerifyResult {
  readonly green: boolean;
  readonly detail?: string;
}

export interface FeatureLandingContext {
  readonly log: EventLog;
  readonly actorId: string;
  readonly runId?: string | null;
  readonly repoRoot: string;
  /** The branch the feature lands on — `repoRoot` must be checked out on it. */
  readonly baseRef: string;
  readonly metadataPaths: readonly string[];
  /** Tier-D verify on the synthetic head. Sandboxed close-gate runner in production, a fake in tests. */
  readonly verifySynthetic: (
    record: SyntheticBranchRecord,
  ) => Promise<SyntheticVerifyResult>;
  readonly worktreesDir?: string;
}

export interface FeatureLandingOutcome {
  readonly featureId: string;
  readonly landed: boolean;
  /** The sentence a person reads: what landed, or why the feature refused/waits. */
  readonly detail: string;
  readonly mergeSha?: string;
}

async function refuse(
  ctx: FeatureLandingContext,
  record: SyntheticBranchRecord | null,
  featureId: string,
  detail: string,
): Promise<FeatureLandingOutcome> {
  if (record) await cleanupSyntheticBranch(ctx.repoRoot, record);
  return { featureId, landed: false, detail };
}

/**
 * Land one complete feature as ONE merge, or refuse whole. Every refusal
 * leaves `baseRef` untouched and the parked member branches intact.
 */
export async function landParkedFeature(
  ctx: FeatureLandingContext,
  featureId: string,
  members: readonly ParkedBranchRecord[],
): Promise<FeatureLandingOutcome> {
  const currentBranch = await resolveCurrentBranch(ctx.repoRoot).catch(() => null);
  if (currentBranch !== ctx.baseRef) {
    return refuse(
      ctx,
      null,
      featureId,
      `repo is checked out on ${currentBranch ?? 'a detached HEAD'}, not ${ctx.baseRef} — landing only ever merges onto the base it verified against`,
    );
  }
  const record = await buildSyntheticBranch({
    repoRoot: ctx.repoRoot,
    baseRef: ctx.baseRef,
    featureId,
    members,
    metadataPaths: ctx.metadataPaths,
    ...(ctx.worktreesDir ? { worktreesDir: ctx.worktreesDir } : {}),
  });
  if (record.conflicted.length > 0) {
    const names = record.conflicted
      .map((c) => `${c.ticketId} (${c.files.join(', ') || 'unknown files'})`)
      .join('; ');
    return refuse(
      ctx,
      record,
      featureId,
      `member(s) conflicted on the synthetic branch — ${names}; a feature does not land in pieces, and no conflict is ever hand-resolved`,
    );
  }
  if (record.dirty !== null) {
    return refuse(
      ctx,
      record,
      featureId,
      `${record.dirty} — refusing to gate a lying substrate`,
    );
  }
  const verify = await ctx.verifySynthetic(record);
  if (!verify.green) {
    return refuse(
      ctx,
      record,
      featureId,
      `verify RED on the synthetic head — ${verify.detail ?? 'no detail'}`,
    );
  }
  for (const member of members) {
    const now = await git(ctx.repoRoot, ['rev-parse', member.branch])
      .then((r) => r.stdout.trim())
      .catch(() => null);
    if (now !== member.headSha) {
      return refuse(
        ctx,
        record,
        featureId,
        `member ${member.ticketId} moved after its park (${member.headSha.slice(0, 8)} -> ${now?.slice(0, 8) ?? 'branch gone'}) — the tested head is not what would land; intact members remain parked assets`,
      );
    }
  }
  const baseNow = (await git(ctx.repoRoot, ['rev-parse', ctx.baseRef])).stdout.trim();
  if (baseNow !== record.baseSha) {
    return refuse(
      ctx,
      record,
      featureId,
      `${ctx.baseRef} advanced under the landing (${record.baseSha.slice(0, 8)} -> ${baseNow.slice(0, 8)}) — the tested head no longer describes ${ctx.baseRef} plus this feature`,
    );
  }
  const ids = members.map((m) => m.ticketId);
  try {
    await git(ctx.repoRoot, [
      'merge',
      '--no-ff',
      '-q',
      '-m',
      `Merge feature ${featureId}: ${members.length} ticket(s) as one landing (${ids.join(', ')})\n\nVerify re-run green on synthetic ${record.headSha.slice(0, 12)}; drift checks green.`,
      record.branch,
    ]);
  } catch (err) {
    // Finding 7b: never leave the root mid-merge. Abort, refuse whole.
    try {
      await git(ctx.repoRoot, ['merge', '--abort']);
    } catch {
      /* no in-progress merge to abort */
    }
    return refuse(
      ctx,
      record,
      featureId,
      `final merge failed and was aborted — ${String((err as Error).message ?? err).slice(0, 200)}`,
    );
  }
  const mergeSha = (await git(ctx.repoRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  // The durable retirement of the parks (parkedBranches replays this), and
  // the human trail on each member. A LANDING at last — never called a park.
  appendEvent(ctx.log, {
    eventType: FEATURE_LANDED_EVENT,
    actorId: ctx.actorId,
    runId: ctx.runId ?? null,
    payload: {
      feature_id: featureId,
      tickets: ids,
      merge_sha: mergeSha,
      synthetic_head: record.headSha,
      members: members.map((m) => ({
        ticket_id: m.ticketId,
        branch: m.branch,
        head_sha: m.headSha,
      })),
    },
  });
  for (const member of members) {
    commentTicket(
      ctx.log,
      {
        ticketId: member.ticketId,
        actorId: ctx.actorId,
        body: `feature ${featureId} landed as one merge ${mergeSha.slice(0, 12)} on ${ctx.baseRef}; parked branch ${member.branch} (${member.headSha.slice(0, 8)}) merged via synthetic ${record.headSha.slice(0, 12)}`,
      },
      { runId: ctx.runId ?? null },
    );
  }
  // Cleanup: the synthetic is discarded, the member worktrees/branches have
  // landed and go too — best effort, a leftover is inspectable, not fatal.
  await cleanupSyntheticBranch(ctx.repoRoot, record);
  for (const member of members) {
    const memberWt = path.join(ctx.repoRoot, '.dokima', 'worktrees', member.ticketId);
    try {
      await git(ctx.repoRoot, ['worktree', 'remove', '--force', memberWt]);
    } catch {
      /* no worktree — already gone */
    }
    try {
      await git(ctx.repoRoot, ['branch', '-d', member.branch]);
    } catch {
      /* branch gone, or unexpectedly unmerged — keep it inspectable */
    }
  }
  return {
    featureId,
    landed: true,
    detail: `landed as one merge ${mergeSha.slice(0, 12)} (${ids.join(', ')}); verify green on synthetic ${record.headSha.slice(0, 12)}`,
    mergeSha,
  };
}
