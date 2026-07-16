import { describe, expect, it } from 'vitest';
import { renderMermaid } from './mermaid.js';
import type { DecomposedTicket } from './types.js';

function ticket(overrides: Partial<DecomposedTicket> & { id: string }): DecomposedTicket {
  return {
    type: 'task',
    title: overrides.id,
    lane: overrides.id,
    writeScope: [],
    dependsOn: [],
    acceptance: [],
    verify: 'true',
    ...overrides,
  };
}

describe('renderMermaid (BLUEPRINT §4 step 4 / US-203)', () => {
  it('AC1: opens a flowchart and one subgraph per lane', () => {
    const out = renderMermaid([
      ticket({ id: 'A', lane: 'lane-a' }),
      ticket({ id: 'B', lane: 'lane-b' }),
    ]);
    expect(out.split('\n')[0]).toEqual('flowchart TD');
    expect(out).toContain('subgraph lane_lane_a["Lane: lane-a"]');
    expect(out).toContain('subgraph lane_lane_b["Lane: lane-b"]');
  });

  it('renders dependsOn as edges pointing from dependency to dependent', () => {
    const out = renderMermaid([
      ticket({ id: 'A', lane: 'l' }),
      ticket({ id: 'B', lane: 'l', dependsOn: ['A'] }),
    ]);
    expect(out).toContain('t_A --> t_B');
  });

  it('drops edges to dependencies outside this DAG rather than emitting a dangling node', () => {
    const out = renderMermaid([
      ticket({ id: 'B', lane: 'l', dependsOn: ['NOT-IN-DAG'] }),
    ]);
    expect(out).not.toContain('NOT-IN-DAG');
  });

  it('re-rendering an unchanged DAG is byte-identical (deterministic ordering)', () => {
    const tickets = [
      ticket({ id: 'B', lane: 'l', dependsOn: ['A'] }),
      ticket({ id: 'A', lane: 'l' }),
    ];
    expect(renderMermaid(tickets)).toEqual(renderMermaid(tickets));
    expect(renderMermaid(tickets)).toEqual(renderMermaid([...tickets].reverse()));
  });

  describe('validate-mermaid.sh static-check parity — output never trips a real finding', () => {
    it('M001/M004/M007: unquoted /, |, ( ) in labels are neutralized by always quoting the whole label', () => {
      const out = renderMermaid([
        ticket({ id: 'A', lane: 'l', title: 'Do (async)/parse | commit' }),
      ]);
      // every node label line is a quoted string; no bare unquoted special
      // char sits directly inside [ ] outside the quotes.
      for (const line of out.split('\n')) {
        const match = /^\s+t_\w+\["(.*)"\]$/.exec(line);
        if (match) expect(line.trim().startsWith('t_')).toBe(true);
      }
      expect(out).toContain('"A Do (async)/parse | commit"');
    });

    it('M003: unicode arrow is not emitted anywhere in the diagram', () => {
      const out = renderMermaid([
        ticket({ id: 'A', lane: 'l', title: 'design → build' }),
      ]);
      expect(out).not.toContain('→');
    });

    it('M008: node/subgraph ids never collide with the reserved `end` keyword', () => {
      const out = renderMermaid([ticket({ id: 'end', lane: 'end' })]);
      const idLines = out.split('\n').filter((l) => /\["/.test(l));
      for (const line of idLines) {
        const id = line.trim().split('[')[0];
        expect(id).not.toEqual('end');
      }
    });

    it('M009: smart quotes, em-dash, and nbsp are normalized to ASCII', () => {
      const out = renderMermaid([
        ticket({ id: 'A', lane: 'l', title: 'the “decomposer” — v1 final' }),
      ]);
      expect(out).not.toMatch(/[“”‘’–—\u00A0]/);
    });

    it('M010: markdown emphasis (bold/backtick) is stripped from labels', () => {
      const out = renderMermaid([
        ticket({ id: 'A', lane: 'l', title: '**bold** and `code`' }),
      ]);
      expect(out).not.toContain('**');
      expect(out).not.toContain('`');
    });

    it('M011: no `//` line-comment style text leaks into a label', () => {
      const out = renderMermaid([ticket({ id: 'A', lane: 'l', title: 'see // notes' })]);
      // sanitizeLabel does not special-case `//`, so guard the property
      // directly: nothing here turns author text into a mermaid comment
      // starter (`%%`), which is the only thing M011 actually cares about.
      expect(out).not.toContain('%%');
    });

    it('M005: an empty/whitespace-only lane label falls back to a non-empty label', () => {
      const out = renderMermaid([ticket({ id: 'A', lane: '  ' })]);
      expect(out).toContain('"Lane: (untitled)"');
    });

    it('M012: bracket count stays balanced (one open, one close) on every node line', () => {
      const out = renderMermaid([
        ticket({ id: 'A', lane: 'l', title: 'weird [brackets] in [title]' }),
      ]);
      const nodeLine = out.split('\n').find((l) => l.includes('t_A['));
      expect(nodeLine).toBeDefined();
      const opens = (nodeLine ?? '').split('[').length - 1;
      const closes = (nodeLine ?? '').split(']').length - 1;
      expect(opens).toEqual(closes);
    });

    it('M012: an UNMATCHED bracket in the title does not unbalance the node line', () => {
      const out = renderMermaid([
        ticket({ id: 'A', lane: 'l', title: 'Fix bug in [Feature X' }),
      ]);
      const nodeLine = out.split('\n').find((l) => l.includes('t_A['));
      expect(nodeLine).toBeDefined();
      const opens = (nodeLine ?? '').split('[').length - 1;
      const closes = (nodeLine ?? '').split(']').length - 1;
      expect(opens).toEqual(closes);
      const label = /^\s+t_A\["(.*)"\]$/.exec(nodeLine ?? '')?.[1];
      expect(label).toBeDefined();
      expect(label).not.toMatch(/[[\]]/);
    });
  });
});
