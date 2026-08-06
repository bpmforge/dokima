/**
 * Child-process agent session runner (BLUEPRINT §3.6/§4, §7 trust boundary).
 * Renders a `Handoff` to the universal block, runs it as a child process
 * inside the ticket worktree, and returns a `SessionResult`: the
 * thinking-stripped output, the defensively parsed Completion Manifest
 * (untrusted — never trust it directly, SC-02), and the write-scope
 * violations observed via `git diff` (SC-01 classification).
 *
 * The actual command spawned is fully injected via `spawn` — this module
 * never hardcodes a specific agent CLI or model (that's a role→model matrix
 * decision, FR-G2, made by whoever wires this up) and never opens a socket
 * to a model endpoint itself: this is the escape-hatch runner for an
 * external agent CLI (D-023), not the tool-using session. The session that
 * sends the handoff and a tool schema through `gateway` and executes the
 * returned tool calls lives in `packages/harbormaster/src/agent-session/**`
 * (D-023, ARCHITECTURE.md §4) — `loop` has no `gateway` import today because
 * nothing here calls a model, not because the dependency law forbids it
 * (D-023 corrected that exact misreading before any code was written).
 * `createChildProcessSpawn` below is a real, ready-to-use `node:child_process`
 * implementation for callers that just want to run a CLI; tests inject a
 * fake per the local-first/no-network law (CLAUDE.md law 9).
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { renderHandoff, type Handoff } from './handoff.js';
import {
  parseCompletionManifest,
  stripThinking,
  type CompletionManifest,
  type ManifestParseTier,
} from './session-manifest.js';
import { computeChangedPaths, detectScopeViolations } from './session-scope.js';

export interface SpawnSessionInput {
  readonly prompt: string;
  readonly cwd: string;
}

export interface SpawnSessionOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export type SpawnSession = (input: SpawnSessionInput) => Promise<SpawnSessionOutput>;

export interface RunSessionInput {
  readonly handoff: Handoff;
  /** Ticket worktree root — the session runs here (BLUEPRINT §3.9). */
  readonly cwd: string;
  /** Diff base for the write-scope check. Defaults to 'HEAD' (uncommitted changes). */
  readonly baseRef?: string;
  readonly spawn: SpawnSession;
}

export interface SessionResult {
  readonly exitCode: number | null;
  /** Thinking-stripped combined output (stdout, then stderr). Never contains `<think>` content. */
  readonly output: string;
  readonly manifest: CompletionManifest | null;
  readonly manifestParseTier: ManifestParseTier | null;
  /** Paths the session touched (real `git diff`) that fall outside handoff.writeScope. */
  readonly scopeViolations: readonly string[];
}

/**
 * Runs one agent session for a `Handoff`, inside `input.cwd` (the ticket
 * worktree). Nothing here mutates durable state or trusts the manifest as
 * fact — that's the Harbormaster's job, out-of-session (SC-02).
 *
 * `renderHandoff` here gets no `secretValues`, so only pattern-based
 * redaction applies (FR-S2) — a vault-registered or `.env` exact value
 * reaches the rendered prompt string. Redacting those before they reach
 * `spawn` is this function's only caller's job: wrap `input.spawn` to
 * `redactDeep` the rendered prompt (see `packages/harbormaster/src/
 * loop-land.ts`'s `attemptOnce`, `@dokima/harbormaster`, out of this
 * module's scope) rather than threading the values through here.
 */
export async function runSession(input: RunSessionInput): Promise<SessionResult> {
  const prompt = renderHandoff(input.handoff);
  const { stdout, stderr, exitCode } = await input.spawn({ prompt, cwd: input.cwd });

  const output = stripThinking(`${stdout}\n${stderr}`.trim());
  const { manifest, tier } = parseCompletionManifest(output);

  const changedPaths = await computeChangedPaths(input.cwd, input.baseRef ?? 'HEAD');
  const scopeViolations = detectScopeViolations(changedPaths, input.handoff.writeScope);

  return {
    exitCode,
    output,
    manifest,
    manifestParseTier: tier,
    scopeViolations,
  };
}

export interface ChildProcessSpawnOptions {
  readonly command: string;
  /** Extra args before the prompt, e.g. ['-p'] for a `<cli> -p <prompt>` shape. */
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  /**
   * Env for the spawned session. Defaults to just `PATH` (enough to resolve
   * `command`), never the full `process.env` — an agent session is
   * untrusted (BLUEPRINT §2/§7) and must not default-inherit whatever
   * credentials happen to be in the parent process's environment (SC-03
   * "env snapshot test on spawned sessions: zero token vars", SC-07
   * "cleaned env"). Callers that need more must pass it explicitly.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const MINIMAL_SPAWN_ENV: Readonly<Record<string, string | undefined>> = {
  PATH: process.env.PATH,
};

/**
 * A real `node:child_process` session spawner: `command [...args] prompt`,
 * run in `cwd`, stdout/stderr captured. Not used by default — callers must
 * opt in, keeping this module network/process-free until asked (CLAUDE.md
 * law 9: everything must work with a fake/local model and no network).
 */
export function createChildProcessSpawn(options: ChildProcessSpawnOptions): SpawnSession {
  return (input) =>
    new Promise<SpawnSessionOutput>((resolve, reject) => {
      const child = nodeSpawn(options.command, [...(options.args ?? []), input.prompt], {
        cwd: input.cwd,
        env: options.env ?? MINIMAL_SPAWN_ENV,
        timeout: options.timeoutMs,
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode });
      });
    });
}
