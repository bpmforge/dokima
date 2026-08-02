import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRosterExperts, RosterContentModelIdError } from './roster-content.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REAL_CONTENT_DIR = path.resolve(here, '../../../../content/experts');

/** Independent re-scan (not the loader's own frontmatter parser) — the count this test asserts against isn't a magic number, it's this walk's own predicate applied fresh. */
async function independentlyCountDispatchableExperts(dir: string): Promise<number> {
  let count = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await independentlyCountDispatchableExperts(full);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const raw = await fs.readFile(full, 'utf8');
    const frontmatter = raw.split('\n---', 1)[0] ?? '';
    const hasMode = /^mode:/m.test(frontmatter);
    const disabled = /^disable:\s*true/m.test(frontmatter);
    if (hasMode && !disabled) count += 1;
  }
  return count;
}

const tmpDirs: string[] = [];
async function tmpContentDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-roster-content-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('loadRosterExperts — real content/experts tree', () => {
  it('lists every dispatchable expert, matching an independent re-scan', async () => {
    const expected = await independentlyCountDispatchableExperts(REAL_CONTENT_DIR);
    const experts = await loadRosterExperts(REAL_CONTENT_DIR);
    expect(experts.length).toBe(expected);
    expect(experts.length).toBeGreaterThan(50); // sanity floor — the real tree has 77 as of this writing
  });

  it('excludes disable:true reference docs and mode-less protocol docs', async () => {
    const experts = await loadRosterExperts(REAL_CONTENT_DIR);
    const ids = experts.map((e) => e.id);
    expect(ids).not.toContain('METHODOLOGY');
    expect(ids).not.toContain('FINDINGS_SCHEMA');
    expect(ids).not.toContain('FINDING_SCHEMA');
    expect(ids).not.toContain('PARALLEL_WAVE_PROTOCOL');
  });

  it('parses cluster/mode/description for a known real expert (single-quoted, doubled-quote-escaped description)', async () => {
    const experts = await loadRosterExperts(REAL_CONTENT_DIR);
    const sdlcLead = experts.find((e) => e.id === 'sdlc-lead');
    expect(sdlcLead).toBeDefined();
    expect(sdlcLead?.cluster).toBe('coordinators');
    expect(sdlcLead?.mode).toBe('primary');
    expect(sdlcLead?.description).toContain('Program manager and lead architect');

    const guideScribe = experts.find((e) => e.id === 'guide-scribe');
    expect(guideScribe?.displayName).toBe('Guide Scribe');
    expect(guideScribe?.description).toContain("app-cartographer's STORIES.md");
  });
});

describe('loadRosterExperts — pin roles, not models', () => {
  it('refuses a top-level hardcoded model id and names the violated rule', async () => {
    const dir = await tmpContentDir();
    await fs.mkdir(path.join(dir, 'security'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'security', 'poisoned.md'),
      [
        '---',
        "description: 'Poisoned expert'",
        'mode: "primary"',
        'model: claude-opus-4-8',
        '---',
      ].join('\n'),
      'utf8',
    );

    await expect(loadRosterExperts(dir)).rejects.toThrow(RosterContentModelIdError);
    await expect(loadRosterExperts(dir)).rejects.toThrow(/FR-E2: pin roles, not models/);
    await expect(loadRosterExperts(dir)).rejects.toThrow(/claude-opus-4-8/);
  });

  it('refuses a nested metadata.model hardcoded id', async () => {
    const dir = await tmpContentDir();
    await fs.writeFile(
      path.join(dir, 'poisoned-nested.md'),
      [
        '---',
        "description: 'Poisoned expert'",
        'mode: "primary"',
        'metadata:',
        '  model: gpt-5.1',
        '---',
      ].join('\n'),
      'utf8',
    );

    await expect(loadRosterExperts(dir)).rejects.toThrow(RosterContentModelIdError);
    await expect(loadRosterExperts(dir)).rejects.toThrow(/gpt-5\.1/);
  });

  it('does not false-refuse a clean expert with no model key at all', async () => {
    const dir = await tmpContentDir();
    await fs.writeFile(
      path.join(dir, 'clean.md'),
      ['---', "description: 'A clean expert'", 'mode: "primary"', '---'].join('\n'),
      'utf8',
    );

    const experts = await loadRosterExperts(dir);
    expect(experts).toHaveLength(1);
    expect(experts[0]?.id).toBe('clean');
  });
});
