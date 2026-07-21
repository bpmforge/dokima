import { describe, expect, it } from 'vitest';
import { createTestHandle as createCodeIndexHandle } from '../code-index/test-helpers.js';
import { insertCodeChunk } from '../code-index/store.js';
import { createTestHandle as createFactsHandle } from '../store/test-helpers.js';
import { insertFact, markFactVerified } from '../store/facts.js';
import { assemblePacket, type PackerTicketInfo } from './pack.js';
import { buildCoreBlock } from './core-block.js';
import { buildRepoMapSkeleton } from './repo-map.js';
import { PackerError } from './errors.js';
import { TOKEN_ENVELOPES } from './budget.js';
import type { PacketRedactor } from './redact.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

const CORE_SECTIONS = [
  'Project invariants: append-only events.',
  'Naming: lower-snake in code.',
];
const INDEXED_PATHS = ['src/a.ts', 'src/b.ts'];

function ticket(overrides: Partial<PackerTicketInfo> = {}): PackerTicketInfo {
  return {
    id: 'W7-99',
    title: 'Example ticket',
    acceptance: ['Does the thing.'],
    ...overrides,
  };
}

describe('assemblePacket', () => {
  it('orders sections stably: core block, repo map, then ticket-specific content', async () => {
    const packet = await assemblePacket({
      modelWindowTokens: 32_000,
      coreBlockSections: CORE_SECTIONS,
      indexedPaths: INDEXED_PATHS,
      ticket: ticket(),
      query: 'example',
    });
    const core = buildCoreBlock(CORE_SECTIONS).text;
    const repoMap = buildRepoMapSkeleton(INDEXED_PATHS);
    const corePos = packet.text.indexOf(core);
    const repoMapPos = packet.text.indexOf(repoMap);
    const ticketPos = packet.text.indexOf('TICKET: W7-99');
    expect(corePos).toBe(0);
    expect(repoMapPos).toBeGreaterThan(corePos);
    expect(ticketPos).toBeGreaterThan(repoMapPos);
  });

  it('is byte-identical in its core+repo-map prefix across two different tickets (KV-cache hits)', async () => {
    const base = {
      modelWindowTokens: 32_000,
      coreBlockSections: CORE_SECTIONS,
      indexedPaths: INDEXED_PATHS,
      query: 'example',
    };
    const packetA = await assemblePacket({
      ...base,
      ticket: ticket({ id: 'W1-01', title: 'First' }),
    });
    const packetB = await assemblePacket({
      ...base,
      ticket: ticket({ id: 'W9-09', title: 'Something entirely different' }),
    });
    const expectedPrefix = `${buildCoreBlock(CORE_SECTIONS).text}\n\n${buildRepoMapSkeleton(INDEXED_PATHS)}`;
    expect(packetA.text.startsWith(expectedPrefix)).toBe(true);
    expect(packetB.text.startsWith(expectedPrefix)).toBe(true);
    expect(packetA.text.slice(0, expectedPrefix.length)).toBe(
      packetB.text.slice(0, expectedPrefix.length),
    );
  });

  it('throws PackerError instead of silently truncating an oversized pinned core block', async () => {
    const oversized = 'x'.repeat(1_001 * 4);
    await expect(
      assemblePacket({
        modelWindowTokens: 32_000,
        coreBlockSections: [oversized],
        indexedPaths: [],
        ticket: ticket(),
        query: 'example',
      }),
    ).rejects.toThrow(PackerError);
  });

  it('stays within its working budget for every FR-L8 window tier', async () => {
    for (const tier of TOKEN_ENVELOPES) {
      const packet = await assemblePacket({
        modelWindowTokens: tier.minWindowTokens,
        coreBlockSections: CORE_SECTIONS,
        indexedPaths: INDEXED_PATHS,
        ticket: ticket({ acceptance: ['One acceptance criterion.', 'Another one.'] }),
        query: 'example',
      });
      expect(packet.envelope).toBe(tier);
      expect(packet.tokens).toBeLessThanOrEqual(packet.workingBudget);
    }
  });

  it('includes relevance-ranked code slices from the W7-06 code index (FR-M4)', async () => {
    const codeIndexHandle = createCodeIndexHandle();
    insertCodeChunk(
      codeIndexHandle,
      {
        path: 'src/frobnicate.ts',
        startLine: 1,
        endLine: 3,
        content: 'export function frobnicate() {}',
      },
      NOW,
    );
    const packet = await assemblePacket({
      modelWindowTokens: 32_000,
      coreBlockSections: CORE_SECTIONS,
      indexedPaths: INDEXED_PATHS,
      ticket: ticket(),
      query: 'frobnicate',
      codeIndexHandle,
    });
    expect(packet.text).toContain('RELEVANT CODE');
    expect(packet.text).toContain('src/frobnicate.ts:1-3');
    expect(packet.text).toContain('export function frobnicate() {}');
    expect(packet.droppedSlicesForBudget).toBe(0);
  });

  it('drops low-ranked slices honestly when the working budget is too small', async () => {
    const codeIndexHandle = createCodeIndexHandle();
    for (let i = 0; i < 5; i += 1) {
      insertCodeChunk(
        codeIndexHandle,
        {
          path: `src/f${i}.ts`,
          startLine: 1,
          endLine: 3,
          content: 'export function widget() { return 1; }',
        },
        NOW,
      );
    }
    const packet = await assemblePacket({
      modelWindowTokens: 32_000,
      coreBlockSections: CORE_SECTIONS,
      indexedPaths: INDEXED_PATHS,
      ticket: ticket(),
      query: 'widget',
      codeIndexHandle,
      instructionCostTokens: 19_970, // leaves ~30 tokens of working budget after fixed sections
    });
    expect(packet.droppedSlicesForBudget).toBeGreaterThan(0);
  });

  it('includes prior confirmed findings from store/retrieval.ts#assembleContext', async () => {
    const factsHandle = createFactsHandle();
    const fact = insertFact(
      factsHandle,
      { kind: 'fact', content: 'The build uses pnpm workspaces.', confidence: 0.9 },
      NOW,
    );
    markFactVerified(factsHandle, fact.id);
    const packet = await assemblePacket({
      modelWindowTokens: 32_000,
      coreBlockSections: CORE_SECTIONS,
      indexedPaths: INDEXED_PATHS,
      ticket: ticket(),
      query: 'pnpm workspaces',
      factsHandle,
    });
    expect(packet.text).toContain('PRIOR CONFIRMED FINDINGS');
    expect(packet.text).toContain('The build uses pnpm workspaces.');
  });

  it('prunes failed-attempt prior turns out of the ticket block (R-I1/R-I2)', async () => {
    const packet = await assemblePacket({
      modelWindowTokens: 32_000,
      coreBlockSections: CORE_SECTIONS,
      indexedPaths: INDEXED_PATHS,
      ticket: ticket(),
      query: 'example',
      priorTurns: [
        { outcome: 'failed', summary: 'attempt 1: edited the wrong file' },
        { outcome: 'success', summary: 'attempt 2: gate passed' },
      ],
    });
    expect(packet.text).not.toContain('edited the wrong file');
    expect(packet.text).toContain('attempt 2: gate passed');
  });

  it('calls the injected redactor on the fully assembled packet (SC-06)', async () => {
    const redactor: PacketRedactor = {
      redact: (text) => text.replace(/Project invariants/g, '[REDACTED:core]'),
    };
    const packet = await assemblePacket({
      modelWindowTokens: 32_000,
      coreBlockSections: CORE_SECTIONS,
      indexedPaths: INDEXED_PATHS,
      ticket: ticket(),
      query: 'example',
      redactor,
    });
    expect(packet.text).toContain('[REDACTED:core]');
    expect(packet.text).not.toContain('Project invariants');
  });

  it('reports an honest PARTIAL via emergencyStop when assembled content passes the emergency threshold', async () => {
    const hugeAcceptance = 'x'.repeat(30_000 * 4); // ~30k tokens, over the 32k tier's 28k emergency threshold
    const packet = await assemblePacket({
      modelWindowTokens: 32_000,
      coreBlockSections: CORE_SECTIONS,
      indexedPaths: INDEXED_PATHS,
      ticket: ticket({ acceptance: [hugeAcceptance] }),
      query: 'example',
    });
    expect(packet.emergencyStop?.partial).toBe(true);
    expect(packet.emergencyStop?.reason).toContain('emergency token threshold reached');
  });

  it('has no emergencyStop for an ordinary small packet', async () => {
    const packet = await assemblePacket({
      modelWindowTokens: 32_000,
      coreBlockSections: CORE_SECTIONS,
      indexedPaths: INDEXED_PATHS,
      ticket: ticket(),
      query: 'example',
    });
    expect(packet.emergencyStop).toBeNull();
  });
});
