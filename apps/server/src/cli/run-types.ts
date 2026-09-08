/**
 * cli/run-types.ts — the shapes `run-cmd.ts` and its `run-build.ts` chapter
 * both need, so neither imports the other's module for a type alone (W10-77).
 */

export interface RunCliIO {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => string;
  /**
   * W22-23: `--project <id>` resolves through the fleet registry under this
   * env's DOKIMA_HOME, exactly as `CliIO` documents. `runCli` has always handed
   * `executeRunCommand` its full `CliIO`, so the value was already arriving —
   * this is the type catching up with what it was being given, not a new
   * capability.
   */
  env?: NodeJS.ProcessEnv;
}

/** The subset of `run start` a build-mode run actually reads. */
export interface BuildRunCommand {
  readonly projectId: string;
  readonly actorId: string;
  readonly agentCommand?: string;
  /** W16-02: the concurrency dial (BLUEPRINT §3.6) — absent/1 = the sequential land loop, N>1 = `runBerths`. */
  readonly berths?: number;
  /** W17-06: injected stop signal — the loop checks it at every ticket boundary; the web stop route flips it. */
  readonly stopSwitch?: () => boolean | Promise<boolean>;
  /**
   * W23-02: this caller asked for an approved build (`approved-build-v1`).
   * EXPLICIT AND PER-RUN, never read from stored settings: a project whose
   * autonomy dial says `auto` chose that before this existed, and inheriting
   * it here would opt existing users into unattended completion they never
   * agreed to (D-032). Absent/false is the legacy path, unchanged.
   */
  readonly approvedBuild?: boolean;
  /** W23-02: the run's approved spend, digested with the rest of the specification. */
  readonly budgetUsd?: number | null;
}
