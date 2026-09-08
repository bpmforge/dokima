/**
 * The security tool registry (W23-04, AB-04) — checks that actually execute.
 *
 * WHAT WAS WRONG. `onboard-dispatch-port.ts` runs each security specialist as
 * one `provider.chat()` turn with `verify: 'true'`. A step named
 * `security-sast` therefore produced a model's *description* of a SAST run,
 * and nothing anywhere executed a scanner. A specialist called
 * `semgrep-runner` is not evidence that Semgrep ran — that sentence is the
 * whole reason this module exists.
 *
 * THE ADAPTER CHOOSES THE COMMAND, ALWAYS. Every tool here has a fixed
 * executable and a fixed argument list, both constants in this file. No model
 * output reaches a command line, and there is no code path that lets one:
 * `runSecurityChecks` takes a working directory and a policy, and nothing
 * else. This is the same posture as `packages/validators/src/run.ts`, which
 * this module deliberately mirrors rather than reinvents.
 *
 * "FOUND VULNERABILITIES" AND "FAILED TO RUN" ARE DIFFERENT ANSWERS, and
 * every scanner blurs them with exit codes: Semgrep exits 1 for findings and
 * 2 for a bad rule file; `npm audit` exits 1 for advisories and 1 again when
 * it cannot reach the registry; a validator script exits 2 for its own
 * failure. So each adapter interprets its own exit code and its own output,
 * and a missing executable, a missing rule set, a timeout, unparseable output
 * or an unreachable advisory database all resolve to ERROR or UNAVAILABLE.
 * None of them resolves to PASS. A required check that is ERROR or UNAVAILABLE
 * makes automatic completion ineligible (IMPLEMENTATION_PLAN §6) — the
 * infrastructure being broken is not the same claim as the code being clean.
 *
 * LOCAL-ONLY MEANS LOCAL-ONLY (Law 9b). The dependency audit is the one check
 * that wants a network. Under a local-only policy it does not quietly reach a
 * cloud advisory service: without a local advisory snapshot it reports
 * UNAVAILABLE and says so, and the coverage a user does not have is visible
 * rather than implied.
 */

import { spawnSync } from 'node:child_process';
import { runSandboxed } from './sandbox/index.js';
import {
  SECRETS_CHECK_ID,
  SECURITY_TOOLS,
  digestOfText as digest,
} from './security-tool-adapters.js';

export { SECURITY_TOOLS };

export type CheckStatus =
  'passed' | 'findings' | 'error' | 'unavailable' | 'not_applicable';

/** IMPLEMENTATION_PLAN §6's check-result contract, as this repo's types. */
export interface CheckEvidence {
  readonly checkId: string;
  /** The source snapshot this ran against — a verdict is only about one tree. */
  readonly sourceDigest: string;
  /** Digest of the exact command line, so a changed argument is a changed check. */
  readonly inputDigest: string;
  readonly toolVersion: string | null;
  readonly ruleDigest: string | null;
  readonly status: CheckStatus;
  /** The tool's ORIGINAL exit code, preserved beside the interpreted status. */
  readonly exitCode: number | null;
  readonly artifactDigest: string | null;
  readonly durationMs: number;
  readonly reason: string | null;
  readonly findingCount: number;
}

/** What the runtime knows about how this project is allowed to reach the world. */
export type NetworkPolicy = 'local-only' | 'network-allowed';

export interface ToolRunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

export interface SecurityToolAdapter {
  readonly checkId: string;
  /** The executable, a constant. Never assembled from anything a session produced. */
  readonly executable: string;
  /** The argument list, constants. `{cwd}` is substituted by the runner, nothing else is. */
  readonly args: readonly string[];
  readonly requiresNetwork: boolean;
  /** True when this project's shape makes the check meaningless (NOT_APPLICABLE with a reason). */
  applicable(profile: ProjectProfile): {
    readonly applicable: boolean;
    readonly reason: string | null;
  };
  /** Turns one tool's own exit code and output into a status. */
  interpret(run: ToolRunResult): {
    readonly status: CheckStatus;
    readonly reason: string | null;
    readonly findingCount: number;
  };
}

/** What the runtime measured about the project, used only for applicability. */
export interface ProjectProfile {
  readonly hasNodeManifest: boolean;
  readonly hasLockfile: boolean;
  readonly hasInfrastructureAsCode: boolean;
}

export interface RunSecurityChecksOptions {
  readonly cwd: string;
  readonly sourceDigest: string;
  readonly profile: ProjectProfile;
  readonly networkPolicy: NetworkPolicy;
  /** Absolute path to the bundled secrets scanner, resolved by the caller (content/ is data). */
  readonly secretsValidatorPath?: string | null;
  /**
   * A local advisory snapshot. Without one, a local-only project cannot claim
   * a completed dependency audit — and must not reach a cloud service to get
   * one (Law 9b).
   */
  readonly localAdvisoryDbPath?: string | null;
  readonly timeoutMs?: number;
  /** Injected in tests and in CI; production supplies the sandboxed runner. */
  readonly runTool: (
    adapter: SecurityToolAdapter,
    args: readonly string[],
    opts: {
      readonly cwd: string;
      readonly allowNetwork: boolean;
      readonly timeoutMs: number;
    },
  ) => Promise<ToolRunResult>;
  /** Whether the executable exists on this host. Missing is UNAVAILABLE, never NOT_APPLICABLE. */
  readonly isInstalled: (executable: string) => boolean | Promise<boolean>;
  readonly toolVersion?: (executable: string) => Promise<string | null>;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function evidence(
  adapter: SecurityToolAdapter,
  sourceDigest: string,
  args: readonly string[],
  over: Partial<CheckEvidence>,
): CheckEvidence {
  return {
    checkId: adapter.checkId,
    sourceDigest,
    inputDigest: digest(`${adapter.executable} ${args.join(' ')}`),
    toolVersion: null,
    ruleDigest: null,
    status: 'error',
    exitCode: null,
    artifactDigest: null,
    durationMs: 0,
    reason: null,
    findingCount: 0,
    ...over,
  };
}

/**
 * Runs every registered tool against one source snapshot and returns one
 * `CheckEvidence` per tool, in registry order. Never throws for a tool that
 * fails: a scanner that cannot run is a *result*, and a run that already
 * produced work must not die because a scanner is missing.
 */
export async function runSecurityChecks(
  options: RunSecurityChecksOptions,
): Promise<readonly CheckEvidence[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results: CheckEvidence[] = [];

  for (const adapter of SECURITY_TOOLS) {
    const args = adapter.args.map((arg) =>
      arg === '{cwd}'
        ? options.cwd
        : arg === '{validatorPath}'
          ? (options.secretsValidatorPath ?? '')
          : arg,
    );

    const applicability = adapter.applicable(options.profile);
    if (!applicability.applicable) {
      results.push(
        evidence(adapter, options.sourceDigest, args, {
          status: 'not_applicable',
          reason: applicability.reason,
        }),
      );
      continue;
    }

    if (adapter.checkId === SECRETS_CHECK_ID && !options.secretsValidatorPath) {
      results.push(
        evidence(adapter, options.sourceDigest, args, {
          status: 'unavailable',
          reason: 'the bundled secrets scanner could not be located in this installation',
        }),
      );
      continue;
    }

    // NETWORK POLICY IS DECIDED BEFORE THE TOOL RUNS, not by the tool. A
    // local-only project with no local advisory snapshot gets UNAVAILABLE and
    // an honest sentence — never a silent call to a cloud advisory service.
    const wantsNetwork = adapter.requiresNetwork;
    if (
      wantsNetwork &&
      options.networkPolicy === 'local-only' &&
      !options.localAdvisoryDbPath
    ) {
      results.push(
        evidence(adapter, options.sourceDigest, args, {
          status: 'unavailable',
          reason:
            'this project is local-only and no local advisory snapshot is installed, so the ' +
            'dependency audit did not run. Its coverage is missing, not clean.',
        }),
      );
      continue;
    }

    if (!(await options.isInstalled(adapter.executable))) {
      results.push(
        evidence(adapter, options.sourceDigest, args, {
          status: 'unavailable',
          reason: `${adapter.executable} is not installed on this host, so ${adapter.checkId} did not run`,
        }),
      );
      continue;
    }

    const run = await options.runTool(adapter, args, {
      cwd: options.cwd,
      allowNetwork: wantsNetwork && options.networkPolicy === 'network-allowed',
      timeoutMs,
    });
    const interpreted = adapter.interpret(run);
    results.push(
      evidence(adapter, options.sourceDigest, args, {
        status: interpreted.status,
        reason: interpreted.reason,
        findingCount: interpreted.findingCount,
        exitCode: run.exitCode,
        durationMs: run.durationMs,
        artifactDigest: run.stdout ? digest(run.stdout) : null,
        toolVersion: (await options.toolVersion?.(adapter.executable)) ?? null,
      }),
    );
  }

  return results;
}

/**
 * Whether this evidence set permits an automatic completion. A REQUIRED check
 * that errored or was unavailable does not — "we could not look" is not "we
 * looked and it was fine" (IMPLEMENTATION_PLAN §6). NOT_APPLICABLE does
 * permit it, because it carries a runtime-derived reason for why there was
 * nothing to look at.
 */
export function checksPermitAutomaticCompletion(checks: readonly CheckEvidence[]): {
  readonly eligible: boolean;
  readonly blockedBy: readonly string[];
} {
  const blockedBy = checks
    .filter(
      (c) =>
        c.status === 'error' || c.status === 'unavailable' || c.status === 'findings',
    )
    .map((c) => `${c.checkId}: ${c.status}${c.reason ? ` — ${c.reason}` : ''}`);
  return { eligible: blockedBy.length === 0, blockedBy };
}

/**
 * The production runner: every tool executes inside the existing sandbox
 * (`runSandboxed`, SC-07/FR-I4), with its own deadline and the network flag
 * the policy decided — not one the tool asked for.
 *
 * A `SandboxUnavailableError` becomes a null exit code, which every adapter
 * reads as "did not run", so a host that cannot isolate reports UNAVAILABLE
 * rather than either crashing the run or — far worse — falling back to an
 * unsandboxed execution of a scanner over code an agent session just wrote.
 */
export function sandboxedToolRunner(): RunSecurityChecksOptions['runTool'] {
  return async (adapter, args, opts) => {
    const started = Date.now();
    try {
      const result = await runSandboxed({
        cwd: opts.cwd,
        // Constants only. `adapter.executable` and `args` are this module's own
        // literals plus two runtime-owned paths; no session output reaches here.
        command: [adapter.executable, ...args].map(shellQuote).join(' '),
        allowNetwork: opts.allowNetwork,
        timeoutMs: opts.timeoutMs,
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      };
    } catch (err) {
      return {
        exitCode: null,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        timedOut: false,
        durationMs: Date.now() - started,
      };
    }
  };
}

/**
 * Single-quotes an argument for the sandbox's shell command string. The
 * sandbox takes a command line, not an argv, so the quoting has to happen
 * somewhere; doing it here — over constants and two runtime-owned paths —
 * keeps it out of every adapter and makes the one place auditable.
 */
function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_./=:-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** Whether an executable is on PATH. A miss is UNAVAILABLE, never a pass. */
export function executableIsInstalled(executable: string): boolean {
  const result = spawnSync('command', ['-v', executable], {
    shell: true,
    encoding: 'utf8',
  });
  return result.status === 0;
}
