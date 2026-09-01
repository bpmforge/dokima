/**
 * scheduler/wave-automations-wiring.ts — P6-13: the composition that finally
 * STARTS the P4-01 wave automations. The final make-sure Challenger found the
 * trigger→advisory pipeline built on both ends and connected by a comment:
 * `startWaveAutomations` had no caller, and `pollBranchAdvisoryReviews`'
 * injected review was named only in prose. This chapter is the missing
 * middle: one Review-tier tick over every registered fleet project's PARKED
 * branches, reviewed by the role-routed reviewer model when one resolves and
 * SKIPPED LOUDLY when none does (FR-G5 — an unreviewed branch that looks
 * reviewed is worse than an honest skip).
 *
 * Scope, stated: only the advisory poll is composed here. The dependency
 * sweep and post-merge smoke remain UNSTARTED — their wiring is P6-14, and
 * wave-automations.ts' header now says so instead of implying otherwise.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { openEventLog, type EventLog } from '@dokima/events';
import { git } from '@dokima/git';
import {
  deriveVerifyCommand,
  FEATURE_LANDED_EVENT,
  parkedBranches,
  reRunVerify,
} from '@dokima/harbormaster';
import { emitNotification } from '../api/notifications/index.js';
import { ROLE_CODE_REVIEWER } from '@dokima/gateway';
import { computeFleetRegistryPath, listProjectCards } from '../api/projects.js';
import { resolveModelTarget } from '../api/pipeline/model-resolution.js';
import { providerForConfig } from '../api/pipeline/gateway-model-port/provider.js';
import { targetToConfig } from '../api/pipeline/gateway-model-port/config.js';
import { stateDbPath } from '../api/server/board-project.js';
import {
  createMemoryBranchCursor,
  pollBranchAdvisoryReviews,
  postMergeSmoke,
  runDependencySweep,
  startWaveAutomations,
  type AdvisoryReviewFinding,
  type AuditFinding,
  type SmokeState,
} from './wave-automations.js';

const execFileAsync = promisify(execFile);

const REVIEW_MAX_TOKENS = 2_000;

/** Best-effort JSON findings from a one-shot advisory prompt; prose yields []. */
export function parseAdvisoryFindings(raw: string): AdvisoryReviewFinding[] {
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    const arr: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr.flatMap((f) =>
      f && typeof f === 'object' && 'file' in f && 'issue' in f
        ? [
            {
              severity: String((f as { severity?: unknown }).severity ?? 'NOTED'),
              file: String((f as { file: unknown }).file),
              issue: String((f as { issue: unknown }).issue),
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}

async function advisoryReviewFor(
  projectPath: string,
  branch: string,
  head: string,
  notify: (line: string) => void,
): Promise<readonly AdvisoryReviewFinding[]> {
  let chat: ((prompt: string) => Promise<string>) | null = null;
  try {
    const target = await resolveModelTarget({
      projectPath,
      role: ROLE_CODE_REVIEWER,
      taskType: 'verification',
      actorId: 'wave-automations',
    });
    const provider = await providerForConfig(targetToConfig(target, process.env));
    chat = async (prompt) =>
      (
        await provider.chat({
          model: target.model,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: REVIEW_MAX_TOKENS,
        })
      ).message.content;
  } catch (err) {
    notify(
      `advisory review SKIPPED for ${branch}@${head.slice(0, 8)} — no reviewer model resolves (${err instanceof Error ? err.message : String(err)})`,
    );
    return [];
  }
  const diff = (await git(projectPath, ['diff', `main...${branch}`])).stdout.slice(
    0,
    120_000,
  );
  const raw = await chat(
    `Advisory review of parked branch ${branch}. Reply with ONLY a JSON array ` +
      `[{"severity":"HIGH|MEDIUM|LOW","file":"path","issue":"one line"}] — [] if clean.\n\n${diff}`,
  );
  return parseAdvisoryFindings(raw);
}

/**
 * P6-14: the REAL audit source — the project's own package-manager advisory
 * audit (`pnpm audit --json` / `npm audit --json` by lockfile). Network-
 * dependent by nature, so every failure path is a LOUD skip returning []
 * (FR-G5), never a silent all-clear.
 */
export async function runProjectDepsAudit(
  projectPath: string,
  notify: (line: string) => void,
): Promise<AuditFinding[]> {
  const tool = existsSync(path.join(projectPath, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : existsSync(path.join(projectPath, 'package-lock.json'))
      ? 'npm'
      : null;
  if (!tool) {
    notify(`dependency sweep SKIPPED for ${projectPath} — no supported lockfile`);
    return [];
  }
  let raw = '';
  try {
    const r = await execFileAsync(tool, ['audit', '--json'], {
      cwd: projectPath,
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    raw = r.stdout;
  } catch (err) {
    // Both tools exit non-zero WHEN VULNERABILITIES EXIST — the report is on
    // stdout either way. Only an empty stdout is a real audit failure.
    raw = (err as { stdout?: string }).stdout ?? '';
    if (!raw.trim()) {
      notify(
        `dependency sweep SKIPPED for ${projectPath} — ${tool} audit unavailable (${err instanceof Error ? err.message.slice(0, 120) : String(err)})`,
      );
      return [];
    }
  }
  return parseAuditFindings(raw);
}

/** npm-audit v2 (`vulnerabilities`) and classic (`advisories`) shapes, best-effort. */
export function parseAuditFindings(raw: string): AuditFinding[] {
  try {
    const j = JSON.parse(raw) as {
      vulnerabilities?: Record<
        string,
        { severity?: string; via?: ReadonlyArray<{ title?: string } | string> }
      >;
      advisories?: Record<
        string,
        { module_name?: string; severity?: string; title?: string }
      >;
    };
    const out: AuditFinding[] = [];
    for (const [pkg, v] of Object.entries(j.vulnerabilities ?? {})) {
      const via = (v.via ?? []).find(
        (x): x is { title: string } => typeof x === 'object' && !!x && 'title' in x,
      );
      out.push({
        pkg,
        severity: v.severity ?? 'low',
        advisory: via?.title ?? 'see audit report',
      });
    }
    for (const a of Object.values(j.advisories ?? {})) {
      out.push({
        pkg: a.module_name ?? 'unknown',
        severity: a.severity ?? 'low',
        advisory: a.title ?? 'see audit report',
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Landed-feature events newer than the cursor — the smoke trigger. */
export function featureLandingsSince(log: EventLog, afterSeq: number): number {
  const row = log.db
    .prepare('SELECT MAX(seq) AS maxSeq FROM events WHERE event_type = ?')
    .get(FEATURE_LANDED_EVENT) as { maxSeq: number | null };
  return row.maxSeq !== null && row.maxSeq > afterSeq ? row.maxSeq : afterSeq;
}

/** One tick: poll every registered project's parked branches for new heads. */
export function fleetAdvisoryTick(opts: {
  fleetHome: string | undefined;
  notify: (line: string) => void;
  cursor: ReturnType<typeof createMemoryBranchCursor>;
}): () => Promise<void> {
  // Per-project automation state, process-lifetime (mirrors the branch
  // cursor): smoke consecutive-failure counts + the landed-event high-water
  // mark, and a per-day guard so the network-touching audit runs at most
  // once a day per project rather than every 5-minute tick.
  const smokeStates = new Map<string, SmokeState>();
  const landedSeqCursor = new Map<string, number>();
  const lastAuditDay = new Map<string, string>();
  return async () => {
    const projects = await listProjectCards(computeFleetRegistryPath(opts.fleetHome));
    for (const project of projects) {
      if (!project.available) continue;
      const log = openEventLog(stateDbPath(project.path));
      try {
        // 1) Advisory review of parked branches (P6-13).
        const parked = [...parkedBranches(log).values()];
        if (parked.length > 0) {
          await pollBranchAdvisoryReviews({
            listCandidateBranches: async () =>
              parked.map((p) => ({ branch: p.branch, head: p.headSha })),
            runAdvisoryReview: (branch, head) =>
              advisoryReviewFor(project.path, branch, head, opts.notify).then((f) => [
                ...f,
              ]),
            cursor: opts.cursor,
            notify: opts.notify,
            onError: (branch, err) =>
              opts.notify(
                `advisory review ERROR on ${branch}: ${err instanceof Error ? err.message : String(err)}`,
              ),
          });
        }

        // 2) Dependency sweep (P6-14) — at most daily; proposals land as
        // Review-tier suggestion notifications a human accepts or dismisses.
        const today = new Date().toISOString().slice(0, 10);
        if (lastAuditDay.get(project.path) !== today) {
          lastAuditDay.set(project.path, today);
          await runDependencySweep({
            runAudit: () => runProjectDepsAudit(project.path, opts.notify),
            proposeTicket: (proposal) => {
              try {
                emitNotification(log, {
                  id: `wa-deps-${proposal.title.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 60)}`,
                  tier: 'review',
                  kind: 'suggestion',
                  refType: 'dependency_advisory',
                  refId: null,
                  title: proposal.title,
                  body: { severity: proposal.severity, evidence: proposal.evidence },
                  actorId: 'wave-automations',
                });
              } catch {
                /* deterministic id: an already-emitted proposal stays emitted */
              }
            },
            notify: opts.notify,
          });
        }

        // 3) Post-merge smoke (P6-14): a NEW feature.landed event since the
        // high-water mark runs the project's own derived verify; the second
        // consecutive failure raises a Decide-tier notification. Never a
        // revert (that would be Decide-tier automation).
        const prevSeq = landedSeqCursor.get(project.path) ?? 0;
        const maxSeq = featureLandingsSince(log, prevSeq);
        if (maxSeq > prevSeq) {
          landedSeqCursor.set(project.path, maxSeq);
          const state = smokeStates.get(project.path) ?? { consecutiveFailures: 0 };
          smokeStates.set(project.path, state);
          await postMergeSmoke({
            runSmoke: async () => {
              const command = await deriveVerifyCommand(project.path);
              if (!command) return { ok: false, detail: 'no verify command derivable' };
              const r = await reRunVerify(project.path, command, 10 * 60_000);
              return {
                ok: r.exitCode === 0,
                detail: `${command} exit ${r.exitCode}`,
              };
            },
            state,
            notify: (m) => opts.notify(`smoke [${project.path}]: ${m}`),
            escalateToHuman: (m) => {
              opts.notify(`ESCALATED [${project.path}]: ${m}`);
              try {
                emitNotification(log, {
                  id: `wa-smoke-${maxSeq}`,
                  tier: 'decide',
                  kind: 'blocked',
                  refType: 'post_merge_smoke',
                  refId: String(maxSeq),
                  title: 'Post-merge smoke failed twice — human needed',
                  body: { detail: m },
                  actorId: 'wave-automations',
                });
              } catch {
                /* already escalated for this landing */
              }
            },
          });
        }
      } finally {
        log.close();
      }
    }
  };
}

/** Boot the automations beside the plan scheduler. Returns the stop handle. */
export function startFleetWaveAutomations(opts: {
  fleetHome: string | undefined;
  intervalMs?: number;
  notify?: (line: string) => void;
}): { stop: () => void } {
  const notify =
    opts.notify ?? ((line: string) => console.log(`[wave-automations] ${line}`));
  const stop = startWaveAutomations({
    tick: fleetAdvisoryTick({
      fleetHome: opts.fleetHome,
      notify,
      cursor: createMemoryBranchCursor(),
    }),
    ...(opts.intervalMs !== undefined ? { intervalMs: opts.intervalMs } : {}),
  });
  return { stop };
}
