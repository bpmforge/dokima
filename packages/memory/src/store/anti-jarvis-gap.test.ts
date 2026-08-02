/**
 * The anti-Jarvis-gap test (source-system-foreman-jarvis.md §5's
 * "cautionary tale": a mature memory engine that's never wired into the
 * loop recalls 0 times and is worth nothing). `packages/memory` may not
 * statically import `@dokima/loop` (ARCHITECTURE.md §4 — loop depends
 * on memory, never the reverse) or declare it as a dependency (this
 * ticket's write_scope has no `package.json` to add it under), so this
 * test dynamically imports the REAL loop package by absolute `file://` URL
 * — an established repo precedent (`apps/web/e2e/fixtures/
 * seed-board-tickets.mjs`) for proving real cross-package behavior when a
 * static import isn't available. Both scenarios below run the SAME real,
 * unmodified `runMicroLoop`/`gatherAnchorFacts` from `packages/loop`:
 *
 *  - "the gap": loop's own `createStubMemoryAnchor()` (ships inert on
 *    purpose, source-of-truth for "not wired yet") never recalls anything,
 *    so a self-verify that requires an anchored fact can never pass.
 *  - "the fix": this package's real `createMemoryAnchor`, backed by a real
 *    fact this test writes and verifies through the store, recalls that
 *    fact and the loop reaches DONE because of it.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMemoryAnchor } from './anchor.js';
import { insertFact, markFactVerified } from './facts.js';
import type { SqliteHandle } from './handle.js';
import { createTestHandle } from './test-helpers.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

// Structural stand-ins for packages/loop's real types (memory can't import loop
// statically, so there's no compile-time type to import either — these are
// deliberately minimal, just what this test calls).
interface LoopItemLike {
  readonly id: string;
  readonly description: string;
}

interface AnchorFactLike {
  readonly kind: string;
  readonly source: string;
  readonly statement: string;
}

interface AnchorLike {
  readonly kind: string;
  gather(input: {
    item: LoopItemLike;
    criterion: string;
  }): readonly AnchorFactLike[] | Promise<readonly AnchorFactLike[]>;
}

type GatherAnchorFacts = (
  anchors: readonly AnchorLike[],
  input: { item: LoopItemLike; criterion: string },
) => Promise<readonly AnchorFactLike[]>;

interface MicroLoopGapLike {
  readonly id: string;
  readonly description: string;
}

interface MicroLoopCallbacksLike {
  restateCriterion(
    item: LoopItemLike,
  ): Promise<
    { checkable: true; statement: string } | { checkable: false; reason: string }
  >;
  produce(input: unknown): Promise<{ output: unknown }>;
  gatherEvidence(input: unknown): Promise<readonly unknown[]>;
  selfVerify(input: {
    item: LoopItemLike;
    criterion: string;
  }): Promise<{ passed: boolean; gaps: readonly MicroLoopGapLike[] }>;
}

type MicroLoopResultLike =
  | { readonly status: 'DONE'; readonly manifest: { readonly passesUsed: number } }
  | { readonly status: 'BLOCKED' }
  | { readonly status: 'PARTIAL' };

interface LoopModule {
  runMicroLoop(
    item: LoopItemLike,
    callbacks: MicroLoopCallbacksLike,
    options?: { maxPasses?: number },
  ): Promise<MicroLoopResultLike>;
  gatherAnchorFacts: GatherAnchorFacts;
  createStubMemoryAnchor(): AnchorLike;
}

async function loadLoopPackage(): Promise<LoopModule> {
  return import(
    pathToFileURL(path.join(repoRoot, 'packages', 'loop', 'src', 'index.ts')).href
  ) as Promise<LoopModule>;
}

const NOW = () => '2026-07-20T12:00:00.000Z';
const ITEM: LoopItemLike = {
  id: 'W9-77',
  description: 'fix the cold-start ENOENT crash',
};
const CRITERION = 'the fix cites a prior confirmed error->solution fact';

/**
 * A self-verify that models "this class of fix must be anchored by memory
 * recall to be trusted DONE" — the exact shape of gate the anti-Jarvis-gap
 * test needs: passing depends entirely on whether the anchor actually
 * produced a fact, never on raw self-confidence (FR-L3's invariant).
 */
function memoryAnchoredCallbacks(
  anchors: readonly AnchorLike[],
  gatherAnchorFacts: GatherAnchorFacts,
): MicroLoopCallbacksLike {
  return {
    restateCriterion: async () => ({ checkable: true as const, statement: CRITERION }),
    produce: async () => ({ output: 'applied the fix' }),
    gatherEvidence: async () => [],
    selfVerify: async ({ item, criterion }) => {
      const facts = await gatherAnchorFacts(anchors, { item, criterion });
      if (facts.length === 0) {
        return {
          passed: false,
          gaps: [{ id: 'no-anchor', description: 'no memory anchor fact recalled' }],
        };
      }
      return { passed: true, gaps: [] };
    },
  };
}

describe('anti-Jarvis gap (docs/research/source-system-foreman-jarvis.md §5)', () => {
  it('the gap: loop stub memory anchor never recalls -> real runMicroLoop never reaches DONE', async () => {
    const { runMicroLoop, gatherAnchorFacts, createStubMemoryAnchor } =
      await loadLoopPackage();
    const stubAnchor = createStubMemoryAnchor();

    const result = await runMicroLoop(
      ITEM,
      memoryAnchoredCallbacks([stubAnchor], gatherAnchorFacts),
      { maxPasses: 2 },
    );

    expect(result.status).not.toBe('DONE');
  });

  it("the fix: a real verified fact + this package's real anchor -> real runMicroLoop reaches DONE", async () => {
    const { runMicroLoop, gatherAnchorFacts } = await loadLoopPackage();

    const handle: SqliteHandle = createTestHandle();
    const fact = insertFact(
      handle,
      {
        kind: 'error_solution',
        content: 'ENOENT on cold start -> mkdir -p the target dir before first write',
        confidence: 0.95,
        ticketId: ITEM.id,
      },
      NOW,
    );
    markFactVerified(handle, fact.id);
    const realAnchor = createMemoryAnchor(handle, { now: NOW });

    const result = await runMicroLoop(
      ITEM,
      memoryAnchoredCallbacks([realAnchor], gatherAnchorFacts),
      { maxPasses: 2 },
    );

    expect(result.status).toBe('DONE');
    if (result.status === 'DONE') {
      expect(result.manifest.passesUsed).toBe(1);
    }
  });
});
