/**
 * Shared shapes for the execution sandbox (FR-I4, SC-07). Two profiles
 * produce the same result shape so a receipt can attest to "sandbox ran
 * this" without caring which backend executed it (DEPLOYMENT.md §5: "the
 * container profile changes isolation strength only").
 */

export type SandboxProfile = 'process' | 'container';

export interface SandboxContainerOptions {
  /** Overrides auto-detection (podman preferred, then docker — DEPLOYMENT.md §5). */
  readonly binary?: 'podman' | 'docker';
  /** Defaults to a `node:22-slim`-based image per DEPLOYMENT.md §5. */
  readonly image?: string;
  readonly cpus?: number;
  /** Docker/Podman `--memory` syntax, e.g. `'2g'`. */
  readonly memory?: string;
  readonly pidsLimit?: number;
}

export interface SandboxRunOptions {
  /** The project worktree the command runs against. */
  readonly cwd: string;
  /** Shell command string, run the same way the unsandboxed close-gate verify runs it. */
  readonly command: string;
  /** Defaults to `'process'` (SC-07's restricted-process default). */
  readonly profile?: SandboxProfile;
  /** Opt-in network relaxation, per project. Defaults to `false`. */
  readonly allowNetwork?: boolean;
  readonly timeoutMs?: number;
  /** Grace period after SIGTERM before escalating to SIGKILL. */
  readonly forceKillGraceMs?: number;
  /** Extra env merged over the safe baseline — never the parent's ambient env (SC-06/SC-07). */
  readonly env?: Readonly<Record<string, string>>;
  readonly container?: SandboxContainerOptions;
}

export interface SandboxRunResult {
  readonly profile: SandboxProfile;
  readonly command: string;
  /** `null` only on a spawn error the process never actually started for. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly networkAllowed: boolean;
}

/**
 * Thrown instead of silently running unsandboxed when the platform's
 * network-isolation mechanism (Seatbelt on macOS, a net namespace on Linux,
 * Podman/Docker for the container profile) isn't actually available. A
 * sandbox that can't prove isolation must refuse to run, not degrade quietly
 * — the same fail-closed posture as the W3-01b secrets-scan gate.
 */
export class SandboxUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxUnavailableError';
  }
}
