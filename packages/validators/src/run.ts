import { stat } from 'node:fs/promises';
import { cpus } from 'node:os';
import { execa } from 'execa';
import { parseValidatorOutput, type ValidatorGap } from './contract.js';

export interface ValidatorSpec {
  name: string;
  path: string;
}

export interface ValidatorRunResult {
  name: string;
  /** Normalized 0 (clean) / 1 (gaps) / 2 (validator failure — timeout, spawn error, malformed output, or a contract violation). Never 0 on anything but a genuine clean pass. */
  exitCode: number;
  gapCount: number;
  gaps: ValidatorGap[];
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface RunValidatorOptions {
  /** Sandbox working directory the validator runs against — never the caller's own cwd. */
  cwd: string;
  /** Kill and report failure if the validator hasn't finished by this many ms. */
  timeoutMs: number;
  args?: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** Grace period after SIGTERM before escalating to SIGKILL on a validator that ignores SIGTERM. */
const FORCE_KILL_GRACE_MS = 2_000;

/**
 * Signals the whole process group (negative pid), not just the direct
 * child. A validator script that forks a subprocess (e.g. `sleep 30`) and
 * then dies leaves that grandchild holding the stdout pipe open, which
 * would otherwise keep the runner hanging past the timeout waiting for
 * stdout to close even though the script itself was killed.
 */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Group already gone (process exited on its own between timeout and kill).
  }
}

/**
 * `content/` is data — git doesn't reliably preserve the executable bit for
 * imported scripts, and this runner must not "fix" that by hand-restyling
 * content (law #6). So a spec whose file lacks the executable bit is run
 * through `bash` explicitly instead of being exec'd directly; a spec that
 * *is* executable (e.g. a compiled validator, or a test fixture written with
 * the bit set) still runs as the literal "any executable validator" the
 * contract promises.
 */
async function resolveCommand(
  specPath: string,
  args: readonly string[],
): Promise<{ command: string; args: string[] }> {
  const info = await stat(specPath);
  const isExecutable = (info.mode & 0o111) !== 0;
  return isExecutable
    ? { command: specPath, args: [...args] }
    : { command: 'bash', args: [specPath, ...args] };
}

function failure(
  name: string,
  gaps: ValidatorGap[],
  extra: Partial<ValidatorRunResult> = {},
): ValidatorRunResult {
  return {
    name,
    exitCode: 2,
    gapCount: gaps.length,
    gaps,
    stdout: '',
    stderr: '',
    durationMs: 0,
    timedOut: false,
    ...extra,
  };
}

/**
 * Runs one validator to completion (or until `timeoutMs` elapses) with a
 * fixed sandbox `cwd`, and normalizes the result onto the 0/1/2 contract.
 * A hang (timeout) or garbage stdout is always exitCode 2 — never silently
 * treated as a clean pass, even if the process itself happened to exit 0.
 */
export async function runValidator(
  spec: ValidatorSpec,
  opts: RunValidatorOptions,
): Promise<ValidatorRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();

  let invocation;
  try {
    invocation = await resolveCommand(spec.path, opts.args ?? []);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(
      spec.name,
      [{ category: 'spawn-error', detail: `validator "${spec.name}" ${message}` }],
      { durationMs: Date.now() - start },
    );
  }

  const subprocess = execa(invocation.command, invocation.args, {
    cwd: opts.cwd,
    reject: false,
    // Own process group so timeout kill can reach grandchild processes too.
    detached: true,
  });

  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    if (typeof subprocess.pid === 'number') killGroup(subprocess.pid, 'SIGTERM');
  }, timeoutMs);
  const forceKillTimer = setTimeout(() => {
    if (typeof subprocess.pid === 'number') killGroup(subprocess.pid, 'SIGKILL');
  }, timeoutMs + FORCE_KILL_GRACE_MS);

  let result;
  try {
    result = await subprocess;
  } finally {
    clearTimeout(timeoutTimer);
    clearTimeout(forceKillTimer);
  }
  const durationMs = Date.now() - start;

  if (timedOut) {
    return failure(
      spec.name,
      [
        {
          category: 'timeout',
          detail: `validator "${spec.name}" exceeded ${timeoutMs}ms and was killed`,
        },
      ],
      { durationMs, timedOut: true, stderr: result.stderr ?? '' },
    );
  }

  if (typeof result.exitCode !== 'number') {
    const message =
      result instanceof Error ? result.message : 'validator process failed to start';
    return failure(
      spec.name,
      [{ category: 'spawn-error', detail: `validator "${spec.name}" ${message}` }],
      { durationMs, stderr: result.stderr ?? '' },
    );
  }

  const parsed = parseValidatorOutput(result.stdout ?? '');
  if (parsed === null) {
    return failure(
      spec.name,
      [
        {
          category: 'malformed-output',
          detail:
            `validator "${spec.name}" exited ${result.exitCode} but stdout does not conform ` +
            'to the exit 0/1 + JSON gaps contract',
        },
      ],
      { durationMs, stdout: result.stdout ?? '', stderr: result.stderr ?? '' },
    );
  }

  const declaresClean = result.exitCode === 0 && parsed.gapCount === 0;
  const declaresGaps = result.exitCode === 1 && parsed.gapCount > 0;
  if (!declaresClean && !declaresGaps) {
    // Either the validator's own exit code disagrees with its gap count
    // (e.g. exit 0 with gaps > 0), or it self-reported an internal error
    // (exit 2 by the _lib.sh `fatal()` convention) — both are the
    // validator's own failure, not ours to paper over.
    return failure(
      spec.name,
      [
        ...parsed.gaps,
        {
          category: 'contract-violation',
          detail:
            `validator "${spec.name}" exited ${result.exitCode} with ${parsed.gapCount} gap(s) ` +
            '— exit code and gap count disagree',
        },
      ],
      { durationMs, stdout: result.stdout ?? '', stderr: result.stderr ?? '' },
    );
  }

  return {
    name: spec.name,
    exitCode: result.exitCode,
    gapCount: parsed.gapCount,
    gaps: parsed.gaps,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs,
    timedOut: false,
  };
}

/**
 * How many validators may be starting at once (W21-17).
 *
 * Every validator runs inside the SC-07 sandbox, and sandbox startup is the
 * expensive part — not the script. Measured with a standalone probe against
 * this very function: 8 concurrent runs, 0 failures; 24 concurrent, 24 of 24
 * TIMED OUT; 64, all 64. The scripts were a single `printf`.
 *
 * An unbounded fan-out therefore has a cliff: past some pack size every
 * validator times out at once, and a timeout is reported as a GAP. The gate
 * would tell a founder "your project failed validation" when the truth is
 * "the machine was busy" — the trust model lying, in the safe direction but
 * still lying. Bounding the pool spreads the startup cost instead of
 * multiplying it.
 *
 * Derived from the host rather than a magic number, and never below 2: one
 * validator at a time would make a large pack serial, which is its own kind
 * of wrong.
 */
export function validatorPackConcurrency(cpuCount = cpus().length): number {
  return Math.max(2, Math.min(8, cpuCount - 1));
}

/**
 * Runs every spec against the same sandbox through a BOUNDED pool.
 *
 * Results stay in `specs` order regardless of the order they finish in —
 * callers index into this to pair a result with its spec, so completion order
 * must never leak into it.
 */
export async function runValidatorPack(
  specs: readonly ValidatorSpec[],
  opts: RunValidatorOptions,
): Promise<ValidatorRunResult[]> {
  const limit = validatorPackConcurrency();
  const results = new Array<ValidatorRunResult>(specs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= specs.length) return;
      results[index] = await runValidator(specs[index]!, opts);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, specs.length) }, () => worker()),
  );
  return results;
}
