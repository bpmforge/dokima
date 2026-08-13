import { describe, expect, it } from 'vitest';
import { defaultHandoffBuilder } from '@dokima/harbormaster';
import type { Ticket } from '@dokima/tickets';
import {
  BUILT_IN_INVARIANTS,
  collectCoreBlockSections,
  createPackedHandoffBuilder,
  CORE_BLOCK_BYTE_LIMIT,
} from './handoff-context.js';

function ticketFixture(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'W1-01',
    type: 'feature',
    title: 'wire the board',
    lane: 'core',
    ownerId: null,
    status: 'in_progress',
    interface: null,
    writeScope: ['packages/tickets/src/**'],
    dependsOn: [],
    acceptance: [{ text: 'the board refuses a spoofed lock', done: false }],
    verify: 'pnpm test',
    manifest: null,
    history: [],
    evidence: [],
    claimedAt: null,
    closedAt: null,
    ...overrides,
  } as Ticket;
}

const noRulesFile = {
  readTextFile: async () => null,
  listRepoPaths: async () => ['packages/tickets/src/verbs.ts', 'README.md'],
};

describe('packed HANDOFF context (W12-04, FR-L5)', () => {
  it(
    'RED FIXTURE: the default builder carries the ticket TITLE as its entire ' +
      'context — the defect this ticket exists to fix, asserted against the ' +
      'unchanged `defaultHandoffBuilder` so it stays visible',
    () => {
      const ticket = ticketFixture({ interface: null });
      const handoff = defaultHandoffBuilder()(ticket);

      expect(handoff.context).toBe('wire the board');
      expect(handoff.context).not.toContain('PROJECT INVARIANTS');
      expect(handoff.context).not.toContain('REPO MAP');
    },
  );

  it('the packed builder carries pinned invariants, a repo map and the ticket block', async () => {
    const build = await createPackedHandoffBuilder({
      repoRoot: '/repo',
      modelWindowTokens: 128_000,
      deps: noRulesFile,
    });
    const handoff = await build(ticketFixture());

    expect(handoff.context).toContain('PROJECT INVARIANTS');
    expect(handoff.context).toContain('Stay inside WRITE-SCOPE');
    expect(handoff.context).toContain('REPO MAP');
    expect(handoff.context).toContain('packages/tickets/src/verbs.ts');
    expect(handoff.context).toContain('TICKET: W1-01');
    expect(handoff.context).toContain('the board refuses a spoofed lock');
    // Everything else about the HANDOFF is the default projection.
    expect(handoff.writeScope).toEqual(['packages/tickets/src/**']);
    expect(handoff.verify).toBe('pnpm test');
  });

  it(
    'DEGRADED PATH (C-1/FR-G5): with no code index and no facts store the packet ' +
      'is still well-formed, and the ranked-code section is ABSENT rather than ' +
      'present-but-empty',
    async () => {
      const build = await createPackedHandoffBuilder({
        repoRoot: '/repo',
        modelWindowTokens: 0, // unknown window -> documented conservative floor
        deps: noRulesFile,
      });
      const handoff = await build(ticketFixture());

      expect(handoff.context).toContain('PROJECT INVARIANTS');
      expect(handoff.context).not.toContain('RELEVANT CODE');
      expect(handoff.context).not.toContain('PRIOR CONFIRMED FINDINGS');
      expect(handoff.context.length).toBeGreaterThan('wire the board'.length);
    },
  );

  it("a project's rules file is pinned into the core block when it fits", async () => {
    const sections = await collectCoreBlockSections('/repo', async (path) =>
      path.endsWith('CLAUDE.md') ? '# Laws\n\n1. One ticket at a time.' : null,
    );

    expect(sections).toHaveLength(2);
    expect(sections[0]).toBe(BUILT_IN_INVARIANTS);
    expect(sections[1]).toContain('One ticket at a time');
  });

  it(
    'an oversized rules file is DROPPED WHOLE, never truncated, and the built-in ' +
      'invariants survive — the core block is never empty and never over its ceiling',
    async () => {
      const huge = 'x'.repeat(CORE_BLOCK_BYTE_LIMIT * 2);
      const sections = await collectCoreBlockSections('/repo', async () => huge);

      expect(sections).toEqual([BUILT_IN_INVARIANTS]);
    },
  );
});
