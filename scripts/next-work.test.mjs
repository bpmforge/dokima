/**
 * 2026-08-29. The loop's own "what do I do next" signal. validate-plan's P9
 * printed ONE claimable ticket through a session that closed fourteen,
 * because strict wave order puts the whole board behind a ticket whose
 * acceptance says "BLOCKED BY DESIGN". A signal that is ignored is worse than
 * none — an unattended loop reading it stops with work in front of it.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const roots = [];

function run(tickets) {
  const root = mkdtempSync(join(tmpdir(), 'dokima-next-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  cpSync(join(here, 'next-work.mjs'), join(root, 'scripts', 'next-work.mjs'));
  writeFileSync(join(root, 'plan.json'), JSON.stringify({ version: 1, tickets }, null, 2));
  try {
    return execFileSync(process.execPath, [join(root, 'scripts', 'next-work.mjs')], {
      encoding: 'utf8',
    });
  } finally {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  }
}

const ticket = (over = {}) => ({
  id: 'W1-01',
  title: 'a ticket',
  phase: 1,
  module: 'shared',
  lane: 'core',
  write_scope: ['packages/shared/**'],
  depends_on: [],
  acceptance: ['does the thing'],
  points: 3,
  status: 'todo',
  notes: [],
  stories: [],
  ...over,
});

describe('next-work: what can be worked, and why the rest cannot', () => {
  it('names a NEXT ticket when one is ready', () => {
    const out = run([ticket()]);
    expect(out).toContain('NEXT: W1-01');
    expect(out).toContain('ready: 1');
  });

  it('separates a ticket that needs a DECISION from one that is merely unstarted', () => {
    // The distinction the loop depends on: it can pick up the first and must
    // not pick up the second, however available it looks.
    const out = run([
      ticket({ id: 'W1-01', notes: ['BLOCKED BY DESIGN until a plugin exists'] }),
      ticket({ id: 'W1-02' }),
    ]);
    expect(out).toContain('NEXT: W1-02');
    expect(out).toContain('needs a decision: 1');
    expect(out).toContain('blocked by design');
  });

  it('reads BOTH shapes the board writes for a founder decision', () => {
    // "a founder decision, not a cleanup" has no space before the comma; a
    // pattern that assumed one read W21-36 as ready, and a loop would have
    // claimed a ticket it could not finish.
    const commaShape = run([ticket({ title: 'delete it — a founder decision, not a cleanup' })]);
    expect(commaShape).toContain('needs a decision: 1');
    const sentenceShape = run([ticket({ notes: ['A FOUNDER DECISION SITS INSIDE THIS'] })]);
    expect(sentenceShape).toContain('needs a decision: 1');
  });

  it('a ticket waiting on an unfinished dependency is neither ready nor a decision', () => {
    const out = run([
      ticket({ id: 'W1-01', depends_on: ['W1-02'] }),
      ticket({ id: 'W1-02', status: 'todo' }),
    ]);
    expect(out).toContain('waiting on deps: 1');
    expect(out).toContain('needs: W1-02');
  });

  it('orders what unblocks others first, then the smallest', () => {
    const out = run([
      ticket({ id: 'W1-01', points: 1 }),
      ticket({ id: 'W1-02', points: 8 }),
      ticket({ id: 'W1-03', depends_on: ['W1-02'] }),
    ]);
    // W1-02 is bigger but three-pointer W1-03 waits on it.
    expect(out).toContain('NEXT: W1-02');
  });

  it('says plainly when nothing is ready, rather than printing an empty list', () => {
    const out = run([ticket({ notes: ['DECIDE FIRST, AND RECORD IT'] })]);
    expect(out).toContain('READY: (none)');
  });

  it('names the disagreement with strict wave order instead of hiding it', () => {
    // Where the wave rule and the dependency graph disagree, that IS the
    // finding — the plan's sequencing model has drifted from its own graph.
    const out = run([ticket({ phase: 9 }), ticket({ id: 'W1-02', phase: 1, status: 'todo' })]);
    expect(out).toMatch(/NOTE: strict wave order/);
  });
});
