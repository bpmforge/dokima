// conductor-lib.test.mjs — real tests of conductor.mjs's pure helpers,
// exercised through conductor-lib.mjs (see that file's header for why the
// extraction was necessary: conductor.mjs runs main() as a top-level side
// effect on import, so its helpers cannot be tested by importing the file
// directly).
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  alwaysOkPatterns,
  codingPrompt,
  doneCheckGap,
  globToRegex,
  loadPlanFrom,
  mergeConfig,
  nonWildPrefix,
  parseJson,
  planPath,
  serializePlan,
  wave,
} from './conductor-lib.mjs';

describe('conductor-lib: board load / serialize', () => {
  const scratchDirs = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchDir() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-conductor-lib-'));
    scratchDirs.push(dir);
    return dir;
  }

  it('loadPlanFrom reads and parses plan.json from a directory', async () => {
    const dir = await scratchDir();
    const plan = { version: 1, tickets: [{ id: 'W0-01', status: 'todo' }] };
    await fs.writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan));

    const loaded = loadPlanFrom(dir);

    expect(loaded).toEqual(plan);
  });

  it('serializePlan round-trips through loadPlanFrom unchanged', async () => {
    const dir = await scratchDir();
    const plan = {
      version: 1,
      tickets: [
        { id: 'W9-09', status: 'in_progress', notes: ['a note'] },
        { id: 'W9-10', status: 'todo', notes: [] },
      ],
    };

    await fs.writeFile(path.join(dir, 'plan.json'), serializePlan(plan));
    const roundTripped = loadPlanFrom(dir);

    expect(roundTripped).toEqual(plan);
  });

  it('serializePlan writes 2-space indented JSON with a trailing newline (the on-disk plan.json format)', () => {
    const plan = { version: 1, tickets: [] };

    const out = serializePlan(plan);

    expect(out).toBe('{\n  "version": 1,\n  "tickets": []\n}\n');
  });
});

// W9-10: conductor.mjs cannot drive a repo whose board isn't at the root
// (e.g. Kryptkeeper's docs/board/plan.json). These tests exercise the
// configurable boardPath end to end, including a fixture repo whose board
// lives in a subdirectory — the exact scenario the loader used to be unable
// to read at all.
describe('conductor-lib: configurable boardPath (W9-10)', () => {
  const scratchDirs = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchDir() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-conductor-lib-boardpath-'));
    scratchDirs.push(dir);
    return dir;
  }

  it('DEFAULT_CONFIG.boardPath defaults to plan.json — the root-board behaviour every existing repo (including this one) relies on', () => {
    expect(DEFAULT_CONFIG.boardPath).toBe('plan.json');
  });

  it('planPath resolves relative to a configurable boardPath, defaulting to plan.json at dir root', () => {
    expect(planPath('/repo')).toBe(path.resolve('/repo', 'plan.json'));
    expect(planPath('/repo', 'docs/board/plan.json')).toBe(path.resolve('/repo', 'docs/board/plan.json'));
  });

  it('loadPlanFrom reads a board that is NOT at the repo root when boardPath points into a subdirectory (Kryptkeeper-shaped fixture)', async () => {
    const dir = await scratchDir();
    const plan = { version: 1, tickets: [{ id: 'KK-01', status: 'todo' }] };
    await fs.mkdir(path.join(dir, 'docs', 'board'), { recursive: true });
    await fs.writeFile(path.join(dir, 'docs', 'board', 'plan.json'), JSON.stringify(plan));
    // no plan.json at dir root at all — the pre-W9-10 loader has nothing to find here.

    const loaded = loadPlanFrom(dir, 'docs/board/plan.json');

    expect(loaded).toEqual(plan);
  });

  it('loadPlanFrom still reads plan.json at the root when boardPath is omitted (default unchanged)', async () => {
    const dir = await scratchDir();
    const plan = { version: 1, tickets: [{ id: 'W0-01', status: 'todo' }] };
    await fs.writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan));

    expect(loadPlanFrom(dir)).toEqual(plan);
  });

  it('alwaysOkPatterns always includes the configured boardPath even when a project alwaysOk override omits it', () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      boardPath: 'docs/board/plan.json',
      alwaysOk: ['docs/STATUS.md'],
    });

    expect(alwaysOkPatterns(config)).toContain('docs/board/plan.json');
    expect(alwaysOkPatterns(config)).toContain('docs/STATUS.md');
  });

  it('alwaysOkPatterns does not duplicate boardPath when the alwaysOk list already contains it (default case)', () => {
    expect(alwaysOkPatterns(DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG.alwaysOk);
  });

  it('doneCheckGap names the configured boardPath in the gate-failure message, not a hardcoded plan.json', () => {
    expect(doneCheckGap('todo', 'plan.json')).toBe("plan.json status is 'todo', expected 'done'");
    expect(doneCheckGap('blocked', 'docs/board/plan.json')).toBe(
      "docs/board/plan.json status is 'blocked', expected 'done'",
    );
  });

  it('doneCheckGap defaults to plan.json when boardPath is omitted (default unchanged)', () => {
    expect(doneCheckGap('todo')).toBe("plan.json status is 'todo', expected 'done'");
  });

  it('codingPrompt tells the agent the configured boardPath in all three places it names where the board lives', () => {
    const t = {
      id: 'KK-01',
      title: 'Example ticket',
      lane: 'infra',
      write_scope: ['scripts/**'],
      acceptance: ['does the thing'],
    };

    const prompt = codingPrompt(t, null, 'docs/board/plan.json');

    expect(prompt).toContain('working EXACTLY ONE ticket from docs/board/plan.json');
    expect(prompt).toContain('Set the ticket in_progress in docs/board/plan.json first');
    expect(prompt).toContain('set the ticket done in docs/board/plan.json');
    // must not silently fall back to the hardcoded default while boardPath is custom
    expect(prompt).not.toContain('ticket from plan.json');
    expect(prompt).not.toContain('in_progress in plan.json');
    expect(prompt).not.toContain('ticket done in plan.json');
  });

  it('codingPrompt defaults to plan.json when boardPath is omitted (default unchanged)', () => {
    const t = {
      id: 'W9-10',
      title: 'Example ticket',
      lane: 'infra',
      write_scope: ['scripts/**'],
      acceptance: ['does the thing'],
    };

    const prompt = codingPrompt(t, null);

    expect(prompt).toContain('working EXACTLY ONE ticket from plan.json');
    expect(prompt).toContain('Set the ticket in_progress in plan.json first');
    expect(prompt).toContain('set the ticket done in plan.json');
  });
});

describe('conductor-lib: config merge', () => {
  it('mergeConfig overrides only the keys present in the override, keeping defaults for the rest', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { branchPrefix: 'kk/', gateTimeoutMin: 30 });

    expect(merged.branchPrefix).toBe('kk/');
    expect(merged.gateTimeoutMin).toBe(30);
    // untouched keys still come from DEFAULT_CONFIG
    expect(merged.worktreeDir).toBe(DEFAULT_CONFIG.worktreeDir);
    expect(merged.remotes).toEqual(DEFAULT_CONFIG.remotes);
  });

  it('mergeConfig with an empty override returns the defaults unchanged', () => {
    expect(mergeConfig(DEFAULT_CONFIG, {})).toEqual(DEFAULT_CONFIG);
  });

  it('mergeConfig is a shallow merge: an override key fully replaces the default value, it does not deep-merge', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { install: ['npm', ['ci']] });

    expect(merged.install).toEqual(['npm', ['ci']]);
    expect(merged.gates).toEqual(DEFAULT_CONFIG.gates);
  });
});

describe('conductor-lib: misc pure helpers', () => {
  it('wave extracts the wave prefix from a ticket id', () => {
    expect(wave('W9-09')).toBe('W9');
    expect(wave('W12-03')).toBe('W12');
  });

  it('nonWildPrefix strips everything from the first wildcard onward', () => {
    expect(nonWildPrefix('scripts/**')).toBe('scripts/');
    expect(nonWildPrefix('apps/web/src/*.ts')).toBe('apps/web/src/');
    expect(nonWildPrefix('plan.json')).toBe('plan.json');
  });

  it('globToRegex matches ** across directory boundaries and * within one segment', () => {
    const re = globToRegex('scripts/**');
    expect(re.test('scripts/conductor.mjs')).toBe(true);
    expect(re.test('scripts/nested/dir/file.mjs')).toBe(true);
    expect(re.test('apps/server/index.ts')).toBe(false);

    const singleStar = globToRegex('apps/*/package.json');
    expect(singleStar.test('apps/web/package.json')).toBe(true);
    expect(singleStar.test('apps/web/src/package.json')).toBe(false);
  });

  it('parseJson extracts the first {...} object from surrounding prose and returns null on garbage', () => {
    expect(parseJson('here is the verdict: {"verdict":"APPROVE"} thanks')).toEqual({
      verdict: 'APPROVE',
    });
    expect(parseJson('not json at all')).toBeNull();
  });
});
