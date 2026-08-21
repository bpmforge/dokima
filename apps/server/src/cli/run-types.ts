/**
 * cli/run-types.ts — the shapes `run-cmd.ts` and its `run-build.ts` chapter
 * both need, so neither imports the other's module for a type alone (W10-77).
 */

export interface RunCliIO {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => string;
}

/** The subset of `run start` a build-mode run actually reads. */
export interface BuildRunCommand {
  readonly projectId: string;
  readonly actorId: string;
  readonly agentCommand?: string;
  /** W16-02: the concurrency dial (BLUEPRINT §3.6) — absent/1 = the sequential land loop, N>1 = `runBerths`. */
  readonly berths?: number;
}
