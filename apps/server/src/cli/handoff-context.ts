/**
 * Packed HANDOFF context (W12-04, FR-L5/FR-L8, BLUEPRINT §7.2): composes
 * `@dokima/memory`'s Context Packer into the `HandoffBuilder` seam that
 * `runLandLoop` already accepts, so a ticket session receives project
 * invariants plus a repo-map skeleton under a real token envelope instead
 * of the one line `defaultHandoffBuilder` supplies (`ticket.interface ??
 * ticket.title`).
 *
 * WHY THIS LIVES IN `apps/server` AND NOT IN `harbormaster`: the
 * ARCHITECTURE §4 declared-dependency matrix has a BLANK in the
 * harbormaster x memory cell, while `apps/server` already declares both
 * `@dokima/memory` and `@dokima/harbormaster`. `HandoffBuilder` is an
 * override seam by design, so wiring here needs no matrix amendment — see
 * W12-04's acceptance, which settles this explicitly.
 *
 * The builder is async, which `HandoffBuilder` only started permitting at
 * W12-08 — before that the seam was synchronous and could never have
 * accepted this packer at all.
 */
import { git } from '@dokima/git';
import { defaultHandoffBuilder, type HandoffBuilder } from '@dokima/harbormaster';
import {
  assemblePacket,
  buildCoreBlock,
  CORE_BLOCK_TOKEN_CEILING,
  indexProject,
  type SqliteHandle,
} from '@dokima/memory';
import type { Ticket } from '@dokima/tickets';

/**
 * Read for project invariants, in order; the first that exists wins. Same
 * candidates and the same bounded-read posture as
 * `api/pipeline/onboard-repo-context.ts`, which is this repo's existing
 * precedent for putting a project's own rules in front of a model.
 */
/**
 * What gets pinned into every handoff, in preference order (W22-26).
 *
 * THE BLUEPRINT COMES FIRST, and it is the entry that makes this list work for
 * a project Dokima generated. A live run proved the gap: asked to write
 * `docs/VISION.md` for a personal expense tracker, the maker produced a
 * document about "a clear, maintainable, well-documented codebase" that never
 * mentioned expenses — because its whole context was the built-in invariants,
 * an empty repo map and the ticket's own title. A generated project has no
 * CLAUDE.md and no AGENTS.md, so this list previously matched nothing at all
 * and the pinned block was the generic invariants alone.
 *
 * The ticket's own acceptance had already asked for what it could not get:
 * every deliverable draft carries "It reflects what the interview actually
 * established, not a template", while its verify command is `test -s <path>`.
 * The board demanded grounding the maker was never given and the gate could
 * not check.
 */
export const CORE_BLOCK_FILE_CANDIDATES = [
  '.dokima/blueprint.md',
  'CLAUDE.md',
  'AGENTS.md',
] as const;

/** Matches `onboard-repo-context.ts`'s KEY_FILE_BYTE_LIMIT. */
export const CORE_BLOCK_BYTE_LIMIT = 4_000;

/**
 * Always present, even when the repo carries no rules file, so the pinned
 * block is never empty. Deliberately short: the core block has a hard
 * 1k-token ceiling that `buildCoreBlock` refuses to truncate.
 */
export const BUILT_IN_INVARIANTS = [
  'PROJECT INVARIANTS (pinned):',
  '- Stay inside WRITE-SCOPE. Edits outside it are refused by the close gate, not merged.',
  '- Commit your work on the ticket branch. The close gate checks the manifest against git, never against your word — uncommitted work counts as never done.',
  '- The VERIFY command must exit 0 before you report completion.',
  '- Return a Completion Manifest naming the files you produced and the verify result.',
].join('\n');

export interface PackedHandoffDeps {
  /** Returns file contents, or null when the file does not exist. */
  readonly readTextFile: (path: string) => Promise<string | null>;
  /** Repo-relative paths forming the repo-map skeleton. */
  readonly listRepoPaths: (repoRoot: string) => Promise<readonly string[]>;
}

export interface PackedHandoffOptions {
  readonly repoRoot: string;
  /**
   * The resolved model's context window. `resolveTokenEnvelope` treats
   * anything under 32k as the documented conservative floor, so an unknown
   * window (the external-agent path, which has no `Provider` to ask) may
   * pass 0 rather than inventing a number.
   */
  readonly modelWindowTokens: number;
  readonly role?: string;
  /**
   * W12-09: the SQLite handle the W7-06 code index lives in. `packages/memory`
   * never opens a writable connection itself (`store/handle.ts`) — a caller
   * supplies one, and the sanctioned opener is `@dokima/events`'
   * `openEventLog(...).db`, which `run-build.ts` already holds. Absent, the
   * packet keeps the documented degraded path: core block + repo map + ticket
   * block, no ranked slices.
   */
  readonly codeIndexHandle?: SqliteHandle;
  readonly deps?: Partial<PackedHandoffDeps>;
}

async function defaultReadTextFile(path: string): Promise<string | null> {
  const { readFile } = await import('node:fs/promises');
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function defaultListRepoPaths(repoRoot: string): Promise<readonly string[]> {
  try {
    const out = await git(repoRoot, ['ls-files']);
    return out.stdout.split('\n').filter((line) => line.length > 0);
  } catch {
    // A run against a directory git cannot read still gets a packet — the
    // repo map is the droppable part, the invariants are not.
    return [];
  }
}

/**
 * Project invariants for the pinned block. A rules file that would push the
 * block past its ceiling is DROPPED WHOLE rather than truncated (the
 * packer's own "never naive truncation" rule) — the built-in invariants
 * always survive, so the block is never empty and `assemblePacket` never
 * throws `PackerError` on this path.
 */
export async function collectCoreBlockSections(
  repoRoot: string,
  readTextFile: PackedHandoffDeps['readTextFile'],
): Promise<readonly string[]> {
  const { join } = await import('node:path');
  for (const candidate of CORE_BLOCK_FILE_CANDIDATES) {
    const contents = await readTextFile(join(repoRoot, candidate));
    if (contents === null) continue;
    const bounded = contents.slice(0, CORE_BLOCK_BYTE_LIMIT);
    const withFile = [BUILT_IN_INVARIANTS, `${candidate}:\n${bounded}`];
    if (buildCoreBlock(withFile).withinCeiling) return withFile;
    // Over the ceiling with this file: keep the invariants, drop the file.
    return [BUILT_IN_INVARIANTS];
  }
  return [BUILT_IN_INVARIANTS];
}

/**
 * Builds the packed builder. The core block and repo map are collected ONCE
 * here rather than per ticket: both are ticket-independent, and the packer
 * relies on them being byte-identical across tickets for KV-cache hits
 * (BLUEPRINT §7.2 item 2, stable-prefix ordering).
 */
export async function createPackedHandoffBuilder(
  options: PackedHandoffOptions,
): Promise<HandoffBuilder> {
  const readTextFile = options.deps?.readTextFile ?? defaultReadTextFile;
  const listRepoPaths = options.deps?.listRepoPaths ?? defaultListRepoPaths;

  const coreBlockSections = await collectCoreBlockSections(
    options.repoRoot,
    readTextFile,
  );
  const core = buildCoreBlock(coreBlockSections);
  if (!core.withinCeiling) {
    // Unreachable while BUILT_IN_INVARIANTS stays short, but a named
    // refusal at run start beats an unhandled rejection mid-session.
    throw new Error(
      `the pinned core block is ${core.tokens} tokens, over the ` +
        `${CORE_BLOCK_TOKEN_CEILING}-token ceiling; no ticket session was started`,
    );
  }

  /**
   * NO CODE INDEX IS WIRED YET, and this states it rather than faking it:
   * nothing in `apps/server` opens a W7-06 code-index handle, so
   * `codeIndexHandle`/`factsHandle` are omitted and `assemblePacket`
   * returns a packet with no ranked slices and no prior findings. That is
   * the packer's documented degraded path (C-1/FR-G5), and it is still
   * strictly more than the title this seam carried before.
   */
  /**
   * INDEXED ONCE PER RUN, and the trigger is a decision worth stating:
   * `indexProject` re-indexes every matching file rather than being
   * mtime-gated, so doing it per TICKET would pay the whole cost on every
   * claim. Once at builder construction is bounded and predictable, and a run
   * that claims ten tickets pays it once.
   *
   * Degrades honestly and loudly enough to debug: with no handle there are no
   * slices, and `ripgrepUnavailable` means `rg` is missing so nothing was
   * indexed at all — said once, rather than silently producing an empty index
   * that looks like a repo with no code in it.
   */
  if (options.codeIndexHandle) {
    const result = await indexProject(options.codeIndexHandle, options.repoRoot);
    if (result.ripgrepUnavailable) {
      process.stderr.write(
        '[context] ripgrep is unavailable, so no code index was built — the ' +
          'handoff keeps its project invariants and repo map but carries no ' +
          'ranked code slices.\n',
      );
    }
  }
  const indexedPaths = await listRepoPaths(options.repoRoot);
  const base = defaultHandoffBuilder(options.role);

  return async (ticket: Ticket) => {
    const packet = await assemblePacket({
      modelWindowTokens: options.modelWindowTokens,
      coreBlockSections,
      indexedPaths,
      ticket: {
        id: ticket.id,
        title: ticket.title,
        interfaces: ticket.interface === null ? undefined : [ticket.interface],
        acceptance: ticket.acceptance.map((criterion) => criterion.text),
      },
      query: [ticket.title, ...ticket.writeScope].join(' '),
      ...(options.codeIndexHandle ? { codeIndexHandle: options.codeIndexHandle } : {}),
    });
    return { ...base(ticket), context: packet.text };
  };
}
