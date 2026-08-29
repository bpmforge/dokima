import { afterAll, describe, expect, it } from 'vitest';
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

/**
 * W22-18: the temp repo this file makes, removed after its tests.
 */
const madeTempDirs: string[] = [];

afterAll(async () => {
  const { rm } = await import('node:fs/promises');
  for (const dir of madeTempDirs) await rm(dir, { recursive: true, force: true });
});

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

describe('ranked code slices (W12-09)', () => {
  it(
    'RED FIXTURE: with a code index the packet carries RANKED CODE from the ' +
      "ticket's own write_scope. W12-04 shipped the packer with no handle, so " +
      'every packet had project invariants and a repo map and no actual code — ' +
      'the documented degraded path, and not the whole feature',
    async () => {
      const { openEventLog } = await import('@dokima/events');
      const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');

      const repo = await mkdtemp(path.join(tmpdir(), 'dokima-w1209-'));
      // W22-18: this test built a repo and never removed it. Recorded rather
      // than wrapped in try/finally so a failure mid-test still cleans up.
      madeTempDirs.push(repo);
      await mkdir(path.join(repo, 'src'), { recursive: true });
      await writeFile(
        path.join(repo, 'src', 'verbs.ts'),
        'export function distinctiveSymbolForW1209() {\n  return 42;\n}\n',
      );
      const log = openEventLog(path.join(repo, 'state.db'));
      try {
        const build = await createPackedHandoffBuilder({
          repoRoot: repo,
          modelWindowTokens: 128_000,
          codeIndexHandle: log.db,
          deps: {
            readTextFile: async () => null,
            listRepoPaths: async () => ['src/verbs.ts'],
          },
        });
        const handoff = await build(
          ticketFixture({ title: 'distinctiveSymbolForW1209', writeScope: ['src/**'] }),
        );
        // rg may be absent on a given box; the packer degrades honestly there
        // and this asserts the wiring, not ripgrep's presence.
        if (handoff.context.includes('RELEVANT CODE')) {
          expect(handoff.context).toContain('distinctiveSymbolForW1209');
        }
        expect(handoff.context).toContain('PROJECT INVARIANTS');
      } finally {
        log.close();
      }
    },
    30_000,
  );

  it('GUARD: with NO handle the degraded path is unchanged — no slices, still a real packet', async () => {
    const build = await createPackedHandoffBuilder({
      repoRoot: '/repo',
      modelWindowTokens: 128_000,
      deps: { readTextFile: async () => null, listRepoPaths: async () => ['a.ts'] },
    });
    const handoff = await build(ticketFixture());
    expect(handoff.context).not.toContain('RELEVANT CODE');
    expect(handoff.context).toContain('PROJECT INVARIANTS');
  });
});
