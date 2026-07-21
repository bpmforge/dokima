/**
 * `assemblePacket` (BLUEPRINT §7.2, FR-L5, FR-L8): the Context Packer's
 * single entry point. Composes the pinned core block, the repo-map
 * skeleton, the ticket's own interfaces/acceptance text, relevance-ranked
 * file slices (W7-06 code index, FR-M4), and prior confirmed findings
 * (`store/retrieval.ts#assembleContext`) into one stable-prefix-ordered
 * string under a per-window token envelope (FR-L8). Trimming only ever
 * drops whole slices/findings that don't fit the remaining budget — it
 * never truncates one mid-content ("never naive truncation").
 *
 * Stable-prefix ordering (KV-cache hits, BLUEPRINT §7.2 item 2): the core
 * block and repo-map lead every packet for a given project state and are
 * byte-identical across tickets (neither depends on `ticket`); ticket-
 * specific content (interfaces, acceptance, pruned prior turns, ranked
 * slices, prior findings) always follows.
 *
 * NOT wired into `packages/loop/src/handoff.ts`'s HANDOFF assembly by this
 * ticket: that file lives outside `packages/memory/src/packer/**`, this
 * ticket's declared write_scope. See this ticket's `plan.json` HANDOFF
 * note. Redaction is a defense-in-depth hook here (see `redact.ts`'s
 * header) — `renderHandoff` already redacts `context` unconditionally.
 */
import type { SqliteHandle } from '../store/handle.js';
import type { EmbeddingProvider } from '../store/embeddings.js';
import { assembleContext } from '../store/retrieval.js';
import type { CodeEmbeddingProvider } from '../code-index/embeddings.js';
import type { CodeSearchOptions } from '../code-index/search.js';
import { estimateTokens } from '../store/tokens.js';
import {
  resolveTokenEnvelope,
  workingBudgetAfterInstructionCost,
  type TokenEnvelope,
} from './budget.js';
import { buildCoreBlock, CORE_BLOCK_TOKEN_CEILING } from './core-block.js';
import { buildRepoMapSkeleton } from './repo-map.js';
import { rankFileSlices, type PackedSlice } from './relevance.js';
import { pruneTurns, type PriorTurn } from './prune.js';
import { checkEmergencyStop, type EmergencyStopResult } from './emergency.js';
import { noopPacketRedactor, type PacketRedactor } from './redact.js';
import { PackerError } from './errors.js';

export interface PackerTicketInfo {
  readonly id: string;
  readonly title: string;
  /** Signatures, not bodies (BLUEPRINT §7.2 item 4: write-scope = read-focus). */
  readonly interfaces?: readonly string[];
  readonly acceptance: readonly string[];
}

export interface AssemblePacketOptions {
  readonly modelWindowTokens: number;
  /** Project invariants, tech stack, naming conventions — <=1k tokens (enforced, never truncated). */
  readonly coreBlockSections: readonly string[];
  /** Every path the code index has chunks for; source of the repo-map skeleton. */
  readonly indexedPaths: readonly string[];
  readonly ticket: PackerTicketInfo;
  /** Relevance-search query for both file slices and prior findings (typically the ticket title + write_scope). */
  readonly query: string;
  readonly codeIndexHandle?: SqliteHandle;
  readonly factsHandle?: SqliteHandle;
  readonly pathFilter?: string | null;
  readonly codeEmbeddingProvider?: CodeEmbeddingProvider;
  readonly factsEmbeddingProvider?: EmbeddingProvider;
  readonly instructionCostTokens?: number;
  readonly priorTurns?: readonly PriorTurn[];
  readonly redactor?: PacketRedactor;
}

export interface ContextPacket {
  readonly text: string;
  readonly tokens: number;
  readonly envelope: TokenEnvelope;
  readonly workingBudget: number;
  readonly droppedSlicesForBudget: number;
  readonly droppedFindingsForBudget: number;
  readonly emergencyStop: EmergencyStopResult | null;
}

function renderTicketBlock(
  ticket: PackerTicketInfo,
  prunedTurns: readonly string[],
): string {
  const lines = [
    `TICKET: ${ticket.id} — ${ticket.title}`,
    ticket.interfaces && ticket.interfaces.length > 0
      ? `INTERFACES:\n${ticket.interfaces.join('\n')}`
      : '',
    `ACCEPTANCE:\n${ticket.acceptance.map((a) => `- ${a}`).join('\n')}`,
    prunedTurns.length > 0
      ? `PRIOR TURNS (pruned, R-I1/R-I2):\n${prunedTurns.join('\n')}`
      : '',
  ].filter((line) => line.length > 0);
  return lines.join('\n\n');
}

function renderSlices(slices: readonly PackedSlice[]): string {
  if (slices.length === 0) {
    return '';
  }
  const body = slices
    .map(
      (slice) =>
        `--- ${slice.path}:${slice.startLine}-${slice.endLine} ---\n${slice.content}`,
    )
    .join('\n\n');
  return `RELEVANT CODE (ranked, W7-06 code index):\n${body}`;
}

function renderFindings(
  facts: readonly { readonly fact: { readonly content: string } }[],
): string {
  if (facts.length === 0) {
    return '';
  }
  return `PRIOR CONFIRMED FINDINGS:\n${facts.map((f) => `- ${f.fact.content}`).join('\n')}`;
}

export async function assemblePacket(
  options: AssemblePacketOptions,
): Promise<ContextPacket> {
  const envelope = resolveTokenEnvelope(options.modelWindowTokens);
  const workingBudget = workingBudgetAfterInstructionCost(
    envelope,
    options.instructionCostTokens ?? 0,
  );

  const core = buildCoreBlock(options.coreBlockSections);
  if (!core.withinCeiling) {
    throw new PackerError(
      `core block exceeds the ${CORE_BLOCK_TOKEN_CEILING}-token ceiling (${core.tokens} tokens) — trim project invariants; the packer never silently truncates the pinned block`,
    );
  }

  const repoMap = buildRepoMapSkeleton(options.indexedPaths);
  const prunedTurns = pruneTurns(options.priorTurns ?? []);
  const ticketBlock = renderTicketBlock(options.ticket, prunedTurns);

  const fixedTokens = core.tokens + estimateTokens(repoMap) + estimateTokens(ticketBlock);
  const remainingAfterFixed = Math.max(0, workingBudget - fixedTokens);

  let slices: readonly PackedSlice[] = [];
  let droppedSlicesForBudget = 0;
  if (options.codeIndexHandle) {
    const ranked = await rankFileSlices(
      options.codeIndexHandle,
      options.query,
      remainingAfterFixed,
      {
        pathFilter: options.pathFilter,
        embeddingProvider: options.codeEmbeddingProvider,
      } satisfies CodeSearchOptions,
    );
    slices = ranked.slices;
    droppedSlicesForBudget = ranked.droppedForBudget;
  }
  const slicesTokens = slices.reduce((sum, slice) => sum + slice.tokens, 0);
  const remainingAfterSlices = Math.max(0, remainingAfterFixed - slicesTokens);

  let findings: readonly { readonly fact: { readonly content: string } }[] = [];
  let droppedFindingsForBudget = 0;
  if (options.factsHandle && remainingAfterSlices > 0) {
    const assembled = await assembleContext(options.factsHandle, options.query, {
      tokenBudget: remainingAfterSlices,
      embeddingProvider: options.factsEmbeddingProvider,
    });
    findings = assembled.facts;
    droppedFindingsForBudget = assembled.droppedForBudget;
  }

  const sections = [
    core.text,
    repoMap,
    ticketBlock,
    renderSlices(slices),
    renderFindings(findings),
  ].filter((section) => section.length > 0);

  const redactor = options.redactor ?? noopPacketRedactor;
  const text = redactor.redact(sections.join('\n\n'));
  const tokens = estimateTokens(text);

  return {
    text,
    tokens,
    envelope,
    workingBudget,
    droppedSlicesForBudget,
    droppedFindingsForBudget,
    emergencyStop: checkEmergencyStop(tokens, envelope),
  };
}
