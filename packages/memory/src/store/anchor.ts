/**
 * Memory anchor (BLUEPRINT §3.5 anchor B, source-system-foreman-jarvis.md
 * §5's "the cautionary tale": an unwired memory engine recalls nothing and
 * is worth nothing). `packages/loop/src/anchors.ts` already defines the
 * `Anchor`/`MemoryAnchor` contract and a stub (`createStubMemoryAnchor`,
 * always empty, honest about "not wired yet"). `memory` may not import
 * `loop` (ARCHITECTURE.md §4 — loop depends on memory, never the reverse),
 * so this is a structurally-identical (duck-typed) implementation of that
 * same contract, backed by a real store. `anti-jarvis-gap.test.ts` proves
 * the structural match by feeding this into loop's own `gatherAnchorFacts`
 * and `runMicroLoop`, imported dynamically.
 */
import type { EmbeddingProvider } from './embeddings.js';
import { assembleContext } from './retrieval.js';
import type { SqliteHandle } from './handle.js';

export interface MemoryAnchorFact {
  readonly kind: 'memory';
  readonly source: string;
  readonly statement: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface MemoryAnchorItem {
  readonly id: string;
  readonly description: string;
}

export interface MemoryAnchorGatherInput {
  readonly item: MemoryAnchorItem;
  readonly criterion: string;
}

export interface MemoryAnchor {
  readonly kind: 'memory';
  gather(input: MemoryAnchorGatherInput): Promise<readonly MemoryAnchorFact[]>;
}

export interface CreateMemoryAnchorOptions {
  readonly tokenBudget?: number;
  readonly embeddingProvider?: EmbeddingProvider;
  readonly now?: () => string;
}

const DEFAULT_ANCHOR_TOKEN_BUDGET = 2000;

/**
 * Real memory anchor: recall fires by searching verified facts scoped to
 * the item's id (a ticket/item usually IS a ticket id), keyed on the
 * micro-loop's own criterion + item description. Only verified facts ever
 * surface (`searchFactsBm25`'s WHERE verified = 1) — an anchor can rescue a
 * pass, never fabricate one.
 */
export function createMemoryAnchor(
  handle: SqliteHandle,
  options: CreateMemoryAnchorOptions = {},
): MemoryAnchor {
  return {
    kind: 'memory',
    async gather(input) {
      const assembled = await assembleContext(
        handle,
        `${input.criterion} ${input.item.description}`,
        {
          tokenBudget: options.tokenBudget ?? DEFAULT_ANCHOR_TOKEN_BUDGET,
          embeddingProvider: options.embeddingProvider,
          ticketId: input.item.id,
          now: options.now,
        },
      );
      return assembled.facts.map(({ fact }): MemoryAnchorFact => ({
        kind: 'memory',
        source: `fact:${fact.id}`,
        statement: fact.content,
        detail: {
          confidence: fact.confidence,
          useCount: fact.useCount,
          factKind: fact.kind,
        },
      }));
    },
  };
}
