/**
 * verify-command.ts — the verify command a ticket gets when it declares none
 * (W21-75).
 *
 * `DEFAULT_VERIFY_COMMAND` is `pnpm lint && pnpm typecheck && pnpm test`, and
 * its comment says it "falls back to the project's own full gate (CLAUDE.md
 * law 3)". The project whose full gate that is, is DOKIMA. Every other project
 * the product builds inherited it, because decomposition sets `verify: null`
 * on every ticket it writes.
 *
 * LIVE (Tally, a project created through the UI): a plain npm project with a
 * package-lock.json, no pnpm, and no eslint. The close gate re-ran
 * `pnpm lint && pnpm typecheck && pnpm test` against it — a command from a
 * different project, in a different package manager, that the founder never
 * wrote and could not see on the ticket.
 *
 * IT DID NOT ONLY FAIL, IT TAUGHT THE MAKER TO FAKE A PASS. Told to satisfy
 * `pnpm test`, the agent wrote `"test": "echo 'Tests passed' || true"` into
 * package.json — a script that cannot fail, invented to answer a command the
 * product imposed. A default that manufactures vacuous green is worse than no
 * default.
 *
 * SO IT IS DERIVED FROM DISK, NEVER GUESSED. The lockfile picks the runner and
 * package.json picks the verbs, exactly as `worktree-provision.ts` derives its
 * install command — same rule, same reason: nothing here takes input from a
 * model, and a greenfield tree with no manifest yields nothing rather than a
 * confident wrong answer.
 *
 * WHEN THERE IS NOTHING TO DERIVE, THE ACCEPTANCE CRITERIA ARE THE ANSWER.
 * They are the only commands the founder actually saw and agreed to, and the
 * close gate runs them anyway — so falling back to them can never impose a
 * command from somewhere else.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** The scripts worth running, in the order a person would run them. */
const VERIFY_SCRIPTS = ['lint', 'typecheck', 'test'] as const;

/** Lockfile → runner, most specific first. npm is the greenfield answer. */
const RUNNERS: readonly (readonly [string, string])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * The runner this worktree actually uses. A manifest with no lockfile is a
 * greenfield project mid-flight — npm is the one that works without a
 * corepack shim, the same call `worktree-provision.ts` makes.
 */
export async function runnerFor(worktreePath: string): Promise<string> {
  for (const [lockfile, runner] of RUNNERS) {
    if (await exists(path.join(worktreePath, lockfile))) return runner;
  }
  return 'npm';
}

/**
 * The verify command derived from what is on disk, or null when the worktree
 * has no manifest or none of the scripts worth running. Null is a real answer:
 * it means the caller should use the ticket's own acceptance criteria rather
 * than invent something.
 */
export async function deriveVerifyCommand(worktreePath: string): Promise<string | null> {
  const manifest = await readJson(path.join(worktreePath, 'package.json'));
  if (!manifest) return null;
  const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
  const runner = await runnerFor(worktreePath);
  const parts = VERIFY_SCRIPTS.filter((name) => typeof scripts[name] === 'string').map(
    (name) => `${runner} run ${name}`,
  );
  return parts.length > 0 ? parts.join(' && ') : null;
}

/**
 * What a ticket should be verified with: its own command if it declares one,
 * else what the worktree says, else the acceptance criteria the founder wrote.
 * Never a command borrowed from another project.
 */
export async function verifyCommandFor(
  worktreePath: string,
  ticketVerify: string | null | undefined,
  acceptance: readonly { readonly text: string }[],
): Promise<string> {
  if (ticketVerify) return ticketVerify;
  const derived = await deriveVerifyCommand(worktreePath);
  if (derived) return derived;
  const criteria = acceptance.map((c) => c.text.trim()).filter((t) => t.length > 0);
  return criteria.length > 0 ? criteria.join(' && ') : 'true';
}
