/**
 * W16-05: the phase-advance research gate (FR-P8/FR-P4, US-105 AC-2). Every
 * fixture here is a real on-disk artifact read by the real gate — no mocked
 * validator.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResearchReport } from '@dokima/pipeline';
import { evaluateResearchGate } from './research-gate.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function projectWith(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-research-gate-'));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return root;
}

function report(overrides: Partial<ResearchReport> = {}): ResearchReport {
  return {
    id: 'r-1',
    topic: 'storage engines',
    phase: 0,
    depth: 'quick',
    sources: [{ id: 's-1', url: 'https://example.invalid/doc', tier: 1 }],
    claims: [
      { id: 'c-1', text: 'engine X is durable', impact: 'HIGH', citedSourceIds: ['s-1'] },
    ],
    generatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  };
}

function challenge(verdict: 'CONFIRMED' | 'CONTRADICTED' | 'UNVERIFIABLE'): string {
  return JSON.stringify({
    reportId: 'r-1',
    generatedAt: '2026-08-21T00:00:00.000Z',
    claims: [{ claimId: 'c-1', verdict }],
    incomplete: [],
    contradicted: verdict === 'CONTRADICTED' ? [{ claimId: 'c-1', verdict }] : [],
  });
}

describe('evaluateResearchGate (W16-05)', () => {
  it('RED FIXTURE: a HIGH claim with NO recorded Challenger verdict holds the gate — absence of challenge is refusal, never a pass (US-105 AC-2)', async () => {
    const root = await projectWith({
      'docs/research/storage.json': JSON.stringify(report()),
    });
    const reasons = await evaluateResearchGate(root, 0);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/HIGH-impact claim "c-1"/);
    expect(reasons[0]).toMatch(/no Challenger verdict/);
  });

  it('RED FIXTURE: a CONTRADICTED verdict holds the gate; the SAME report passes once the recorded verdict is CONFIRMED', async () => {
    const root = await projectWith({
      'docs/research/storage.json': JSON.stringify(report()),
      'docs/research/storage.challenge.json': challenge('CONTRADICTED'),
    });
    expect((await evaluateResearchGate(root, 0))[0]).toMatch(/CONTRADICTED/);

    await fs.writeFile(
      path.join(root, 'docs/research/storage.challenge.json'),
      challenge('CONFIRMED'),
    );
    expect(await evaluateResearchGate(root, 0)).toEqual([]);
  });

  it('a report declared for ANOTHER phase does not gate this one, and a project with no docs/research owes nothing', async () => {
    const root = await projectWith({
      'docs/research/later.json': JSON.stringify(report({ phase: 3 })),
    });
    expect(await evaluateResearchGate(root, 0)).toEqual([]);
    const empty = await projectWith({});
    expect(await evaluateResearchGate(empty, 0)).toEqual([]);
  });

  it('markdown research notes are ignored; a malformed .json is a NAMED refusal, never skipped', async () => {
    const root = await projectWith({
      'docs/research/notes.md': '# free-form notes, not a report',
      'docs/research/broken.json': '{not json',
    });
    const reasons = await evaluateResearchGate(root, 0);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/broken\.json is unreadable/);
  });

  it('depth "quick" still enforces its source floor through the real validator', async () => {
    const root = await projectWith({
      'docs/research/thin.json': JSON.stringify(report({ sources: [], claims: [] })),
    });
    const reasons = await evaluateResearchGate(root, 0);
    expect(reasons.join('\n')).toMatch(/no claims/);
    expect(reasons.join('\n')).toMatch(/at least/);
  });
});
