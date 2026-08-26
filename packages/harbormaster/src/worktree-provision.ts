/**
 * worktree-provision.ts — making a fresh worktree able to satisfy its own
 * verify command (W21-12).
 *
 * THE PROBLEM THIS EXISTS FOR, from a live UAT rather than review. A greenfield
 * project's first ticket declared `pnpm lint && pnpm typecheck && pnpm test`.
 * The agent wrote a package.json naming eslint and typescript, committed it,
 * and handed back a Completion Manifest claiming the command passed. The close
 * gate re-ran the command itself — as it must — and refused:
 * `sh: eslint: command not found`. The refusal was right and the ticket was
 * impossible: nothing in the system could put eslint on disk.
 *
 * WHY NOTHING COULD. The agent's tool set (tools.ts) deliberately excludes it:
 * "nothing that can run a free-form process, install a dependency, or open a
 * socket" (SC-18, D-023). And the harness's own command runner, `reRunVerify`,
 * executes inside the SC-07 sandbox, which is `--network=none` on containers
 * and `(deny network*)` under Seatbelt. Both are correct. Between them there
 * was simply no step that provisions dependencies, so every greenfield ticket
 * failed identically forever.
 *
 * WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT. The harness provisions,
 * exactly as it already provisions the git worktree. SC-18 protects against a
 * MODEL running free-form processes, and that stays completely intact: the
 * agent's tool set is untouched (`toolSetHasNoInstallTool` in the tests pins
 * it), and nothing here takes any input from a model. The command is derived
 * from the lockfile on disk and nothing else.
 *
 * This step runs OUTSIDE the SC-07 sandbox, because installing dependencies is
 * exactly the network access that sandbox exists to deny. That is a real
 * widening of what the product does on your machine, it was a founder
 * decision, and it is ledgered every time it happens so it is never silent.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { appendEvent, type EventLog } from '@dokima/events';

/** How long a provision may take before it is killed. Installs are slow. */
export const PROVISION_TIMEOUT_MS = 300_000;

export interface ProvisionPlan {
  /** The executable to run. Never model-supplied. */
  readonly command: string;
  readonly args: readonly string[];
  /** Which file on disk decided this — the evidence for the choice. */
  readonly because: string;
}

/**
 * What (if anything) this worktree needs, decided ONLY from files on disk.
 *
 * Returns null when there is nothing to do — no manifest, or dependencies are
 * already installed. Both are normal: most tickets in an established project
 * hit the second case, and provisioning must not re-run for every ticket.
 */
export async function planProvision(worktreePath: string): Promise<ProvisionPlan | null> {
  const has = async (rel: string): Promise<boolean> => {
    try {
      await fs.stat(path.join(worktreePath, rel));
      return true;
    } catch {
      return false;
    }
  };

  if (!(await has('package.json'))) return null;
  // Already provisioned. Re-installing per ticket would cost minutes and
  // change a tree the agent is about to be judged on.
  if (await has('node_modules')) return null;

  if (await has('pnpm-lock.yaml')) {
    return { command: 'pnpm', args: ['install'], because: 'pnpm-lock.yaml' };
  }
  if (await has('yarn.lock')) {
    return { command: 'yarn', args: ['install'], because: 'yarn.lock' };
  }
  if (await has('package-lock.json')) {
    return { command: 'npm', args: ['install'], because: 'package-lock.json' };
  }
  // A greenfield project has a manifest and no lockfile yet. npm is the one
  // manager guaranteed to exist wherever node does.
  return { command: 'npm', args: ['install'], because: 'package.json with no lockfile' };
}

export interface ProvisionResult {
  readonly ran: boolean;
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly durationMs: number;
  /** Present when it ran; already trimmed for the ledger. */
  readonly output: string;
  readonly plan: ProvisionPlan | null;
}

const MAX_OUTPUT_CHARS = 2_000;

function trim(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…(truncated)`
    : text;
}

async function run(
  plan: ProvisionPlan,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(plan.command, [...plan.args], {
      cwd,
      // Not a shell: the command and args are ours, and a shell would be one
      // more way for a path to be interpreted rather than used.
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      // A missing package manager is a real, reportable outcome — not a crash.
      resolve({ exitCode: null, output: `${output}${String(err)}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, output });
    });
  });
}

export interface ProvisionInput {
  readonly worktreePath: string;
  readonly log: EventLog;
  readonly actorId: string;
  readonly ticketId: string;
  readonly runId?: string;
  readonly timeoutMs?: number;
}

/**
 * Provision the worktree if it needs it. Ledgers what it did either way, so a
 * ticket that later fails on a missing tool can be told apart from one that
 * was never provisioned at all.
 */
export async function provisionWorktree(input: ProvisionInput): Promise<ProvisionResult> {
  const plan = await planProvision(input.worktreePath);
  if (!plan) {
    return { ran: false, ok: true, exitCode: null, durationMs: 0, output: '', plan: null };
  }

  const startedAt = Date.now();
  const { exitCode, output } = await run(
    plan,
    input.worktreePath,
    input.timeoutMs ?? PROVISION_TIMEOUT_MS,
  );
  const durationMs = Date.now() - startedAt;
  const ok = exitCode === 0;

  appendEvent(input.log, {
    eventType: 'worktree.provisioned',
    actorId: input.actorId,
    ticketId: input.ticketId,
    ...(input.runId ? { runId: input.runId } : {}),
    payload: {
      command: `${plan.command} ${plan.args.join(' ')}`,
      because: plan.because,
      exitCode,
      durationMs,
      ok,
      // Only on failure: a successful install's output is thousands of lines
      // of noise, and the ledger is not a build log.
      ...(ok ? {} : { output: trim(output) }),
    },
  });

  return { ran: true, ok, exitCode, durationMs, output: trim(output), plan };
}

/**
 * The line a failed provision contributes to a ticket's evidence. Named
 * distinctly from a verify failure: "your dependencies never installed" and
 * "your code does not pass its checks" point at completely different fixes,
 * and before this existed the first one masqueraded as the second.
 */
export function provisionFailureReason(result: ProvisionResult): string | null {
  if (!result.ran || result.ok || !result.plan) return null;
  return (
    `dependencies were never installed: \`${result.plan.command} ` +
    `${result.plan.args.join(' ')}\` (chosen from ${result.plan.because}) exited ` +
    `${result.exitCode ?? 'without a code'}. The ticket's verify command cannot ` +
    `pass until this does — this is not a failure of the work.\n${result.output}`
  );
}
