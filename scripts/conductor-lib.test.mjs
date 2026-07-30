// conductor-lib.test.mjs — real tests of conductor.mjs's pure helpers,
// exercised through conductor-lib.mjs (see that file's header for why the
// extraction was necessary: conductor.mjs runs main() as a top-level side
// effect on import, so its helpers cannot be tested by importing the file
// directly).
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  alwaysOkPatterns,
  codingPrompt,
  doneCheckGap,
  globToRegex,
  loadConfigFile,
  loadPlanFrom,
  mergeConfig,
  nonWildPrefix,
  parseJson,
  planPath,
  serializePlan,
  claimableTickets,
  migrationCollisions,
  reviewDecision,
  selectGates,
  pageMountWarning,
  nodePinMismatch,
  testSiblingWarning,
  validateModels,
  wave,
  writePlan,
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

// W9-11: the conductor's board writes must be byte-identical to the file
// they replace apart from the statuses actually changed. A JSON.parse
// round-trip comparison CANNOT catch this (W9-09 hit exactly that trap:
// breaking serializePlan's indent still passed a round-trip test) — these
// tests assert raw bytes, against the real repo-root plan.json (493KB+),
// not a toy fixture, per the ticket's own instruction.
const REAL_PLAN_PATH = fileURLToPath(new URL('../plan.json', import.meta.url));

describe('conductor-lib: byte-preserving board writes (W9-11)', () => {
  it('DEMONSTRATES THE DEFECT: naive JSON.stringify(plan, null, 2) + "\\n" diverges from the real plan.json by thousands of bytes', () => {
    const original = readFileSync(REAL_PLAN_PATH, 'utf8');
    const plan = JSON.parse(original);

    const naive = `${JSON.stringify(plan, null, 2)}\n`;

    const delta = Math.abs(Buffer.byteLength(naive, 'utf8') - Buffer.byteLength(original, 'utf8'));
    expect(delta).toBeGreaterThan(2000);
  });

  it('serializePlan(plan, original) reproduces the real plan.json byte-for-byte when nothing changed', () => {
    const original = readFileSync(REAL_PLAN_PATH, 'utf8');
    const plan = JSON.parse(original);

    const out = serializePlan(plan, original);

    expect(out).toBe(original);
  });

  it('changing exactly one ticket status produces a diff touching only that ticket\'s status line', () => {
    const original = readFileSync(REAL_PLAN_PATH, 'utf8');
    const plan = JSON.parse(original);
    const row = plan.tickets.find((t) => t.id === 'W9-09');
    expect(row.status).toBe('done'); // sanity: real starting value this test flips
    row.status = 'blocked';

    const out = serializePlan(plan, original);

    const origLines = original.split('\n');
    const outLines = out.split('\n');
    expect(outLines.length).toBe(origLines.length); // a status swap never adds/removes lines
    const changedLineIdxs = origLines
      .map((line, i) => (line === outLines[i] ? -1 : i))
      .filter((i) => i !== -1);
    expect(changedLineIdxs).toHaveLength(1);
    expect(origLines[changedLineIdxs[0]]).toBe('      "status": "done",');
    expect(outLines[changedLineIdxs[0]]).toBe('      "status": "blocked",');
  });

  it('preserves the file\'s existing convention: ASCII-only source (real plan.json\'s \\u00a7-style escaping) stays ASCII-escaped, even for brand-new non-ASCII content not previously in the file', () => {
    const original = '{\n  "version": 1,\n  "note": "no unicode here"\n}';
    const plan = JSON.parse(original);
    plan.note = 'now has § and —';

    const out = serializePlan(plan, original);

    expect(out).toContain('\\u00a7');
    expect(out).toContain('\\u2014');
    expect(out).not.toContain('§');
    expect(out).not.toContain('—');
  });

  it('preserves the file\'s existing convention: a source that already writes literal UTF-8 is NOT forced into ASCII-escaping', () => {
    const original = '{\n  "version": 1,\n  "note": "§ literal — utf8"\n}';
    const plan = JSON.parse(original);

    const out = serializePlan(plan, original);

    expect(out).toContain('§');
    expect(out).toContain('—');
    expect(out).not.toContain('\\u00a7');
    expect(out).not.toContain('\\u2014');
  });

  it('preserves the absence of a trailing newline when the source file has none (the real plan.json has none)', () => {
    const original = '{\n  "version": 1\n}';
    const plan = JSON.parse(original);

    const out = serializePlan(plan, original);

    expect(out.endsWith('\n')).toBe(false);
  });

  it('preserves a trailing newline when the source file has one', () => {
    const original = '{\n  "version": 1\n}\n';
    const plan = JSON.parse(original);

    const out = serializePlan(plan, original);

    expect(out.endsWith('\n')).toBe(true);
  });

  it('without an original (e.g. writing a brand-new board), falls back to literal UTF-8 with a trailing newline — unchanged pre-W9-11 default', () => {
    const plan = { version: 1, tickets: [] };

    const out = serializePlan(plan);

    expect(out).toBe('{\n  "version": 1,\n  "tickets": []\n}\n');
  });
});

// W9-11: serializePlan being byte-preserving is not enough — the conductor's
// actual board write must go through it WITH the file's own bytes as
// `original`, or the fix never reaches production. writePlan is the one
// place both conductor.mjs call sites (resetStatus, markBlocked) perform a
// board write, so these tests cover the real write path end to end
// (scratch-dir file on disk, real fs.readFileSync, real fs.writeFileSync),
// not just the pure serializer.
describe('conductor-lib: writePlan — the conductor board write is byte-preserving end to end (W9-11)', () => {
  const scratchDirs = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchDir() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-conductor-lib-writeplan-'));
    scratchDirs.push(dir);
    return dir;
  }

  it('a board write through writePlan changes only the touched ticket\'s status line, on a fixture using the real plan.json\'s own convention (ASCII-escaped, no trailing newline)', async () => {
    const dir = await scratchDir();
    const original =
      '{\n' +
      '  "version": 1,\n' +
      '  "tickets": [\n' +
      '    {\n' +
      '      "id": "W0-01",\n' +
      '      "status": "todo",\n' +
      '      "notes": "uses \\u00a7 and \\u2014 like the real board"\n' +
      '    },\n' +
      '    {\n' +
      '      "id": "W0-02",\n' +
      '      "status": "todo"\n' +
      '    }\n' +
      '  ]\n' +
      '}'; // no trailing newline — matches the real plan.json
    const boardFile = path.join(dir, 'plan.json');
    await fs.writeFile(boardFile, original);

    const plan = loadPlanFrom(dir);
    plan.tickets.find((t) => t.id === 'W0-01').status = 'in_progress';
    writePlan(dir, plan);

    const out = await fs.readFile(boardFile, 'utf8');
    const origLines = original.split('\n');
    const outLines = out.split('\n');
    expect(outLines.length).toBe(origLines.length);
    const changedLineIdxs = origLines.map((line, i) => (line === outLines[i] ? -1 : i)).filter((i) => i !== -1);
    expect(changedLineIdxs).toHaveLength(1);
    expect(outLines[changedLineIdxs[0]]).toBe('      "status": "in_progress",');
    // convention preserved: still ASCII-escaped, still no trailing newline
    expect(out).toContain('\\u00a7');
    expect(out).not.toContain('§');
    expect(out.endsWith('\n')).toBe(false);
  });

  it('writePlan honours a configured boardPath (W9-10), not just the root plan.json default', async () => {
    const dir = await scratchDir();
    await fs.mkdir(path.join(dir, 'docs', 'board'), { recursive: true });
    const original = '{\n  "tickets": [\n    {\n      "id": "KK-01",\n      "status": "todo"\n    }\n  ]\n}';
    const boardFile = path.join(dir, 'docs', 'board', 'plan.json');
    await fs.writeFile(boardFile, original);

    const plan = loadPlanFrom(dir, 'docs/board/plan.json');
    plan.tickets[0].status = 'done';
    writePlan(dir, plan, 'docs/board/plan.json');

    const out = await fs.readFile(boardFile, 'utf8');
    expect(out).toBe('{\n  "tickets": [\n    {\n      "id": "KK-01",\n      "status": "done"\n    }\n  ]\n}');
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

describe('conductor-lib: model routing config (W9-12)', () => {
  it('DEFAULT_CONFIG.models has every role the conductor dispatches sessions to, and passes its own validator', () => {
    expect(validateModels(DEFAULT_CONFIG.models)).toEqual([]);
    for (const role of ['maker', 'cheap', 'reviewer', 'security', 'escalate']) {
      expect(typeof DEFAULT_CONFIG.models[role]).toBe('string');
    }
  });

  it('validateModels accepts a fully-specified models object', () => {
    const models = { maker: 'sonnet', cheap: 'haiku', reviewer: 'sonnet', security: 'sonnet', escalate: 'opus' };
    expect(validateModels(models)).toEqual([]);
  });

  it('validateModels reports every missing required role by name, not just the first', () => {
    const errors = validateModels({ maker: 'sonnet' });
    expect(errors).toHaveLength(4);
    expect(errors.some((e) => e.includes('models.cheap'))).toBe(true);
    expect(errors.some((e) => e.includes('models.reviewer'))).toBe(true);
    expect(errors.some((e) => e.includes('models.security'))).toBe(true);
    expect(errors.some((e) => e.includes('models.escalate'))).toBe(true);
  });

  it('validateModels rejects an empty-string role (present key, useless value)', () => {
    const models = { maker: 'sonnet', cheap: 'haiku', reviewer: 'sonnet', security: 'sonnet', escalate: '   ' };
    const errors = validateModels(models);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('models.escalate');
  });

  it('validateModels rejects a non-object (the shape a missing "models" key would have if a caller forgot the DEFAULT_CONFIG fallback)', () => {
    expect(validateModels(undefined)).toHaveLength(1);
    expect(validateModels(null)).toHaveLength(1);
    expect(validateModels('sonnet')).toHaveLength(1);
  });

  it('mergeConfig folds a project\'s "models" override in like any other config key (full replace, not deep-merge) — conductor.config.json is the one place model routing lives', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      models: { maker: 'sonnet', cheap: 'haiku', reviewer: 'sonnet', security: 'sonnet', escalate: 'opus', cheapLanes: ['content'] },
    });
    expect(merged.models.cheapLanes).toEqual(['content']);
    expect(validateModels(merged.models)).toEqual([]);
  });

  it('mergeConfig with no "models" override falls back to DEFAULT_CONFIG.models — a project with no models key still gets a valid ladder', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { branchPrefix: 'kk/' });
    expect(merged.models).toEqual(DEFAULT_CONFIG.models);
    expect(validateModels(merged.models)).toEqual([]);
  });
});

describe('conductor-lib: loadConfigFile — malformed conductor.config.json fails clean (W9-12 follow-up)', () => {
  const scratchDirs = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function tmpDir() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-conductor-config-'));
    scratchDirs.push(dir);
    return dir;
  }

  it('returns defaults unchanged when conductor.config.json does not exist', async () => {
    const dir = await tmpDir();
    expect(loadConfigFile(dir, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
  });

  it('merges a valid conductor.config.json over the defaults', async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, 'conductor.config.json'), JSON.stringify({ branchPrefix: 'kk/' }));
    const merged = loadConfigFile(dir, DEFAULT_CONFIG);
    expect(merged.branchPrefix).toBe('kk/');
    expect(merged.models).toEqual(DEFAULT_CONFIG.models);
  });

  it('DEMONSTRATES THE DEFECT this closes: a naive JSON.parse on malformed JSON throws a bare SyntaxError with no mention of which file is broken', async () => {
    const dir = await tmpDir();
    const badFile = path.join(dir, 'conductor.config.json');
    await fs.writeFile(badFile, '{ "boardPath": "plan.json", }'); // trailing comma
    expect(() => JSON.parse(readFileSync(badFile, 'utf8'))).toThrow(SyntaxError);
    // the raw error names neither conductor.config.json nor how to fix it —
    // that is exactly what loadConfigFile below adds.
  });

  it('malformed JSON in conductor.config.json throws an Error naming the file and the parser reason, not a bare SyntaxError', async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, 'conductor.config.json'), '{ "boardPath": "plan.json", }');

    let caught;
    try {
      loadConfigFile(dir, DEFAULT_CONFIG);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toContain('conductor.config.json');
    expect(caught.message).toContain('not valid JSON');
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

describe('conductor-lib: Node version pin is project-configurable (W3-15 portability)', () => {
  it('accepts a matching major', () => {
    expect(nodePinMismatch('v22.23.1', '22')).toBeNull();
  });

  it('rejects a mismatched major and names both versions', () => {
    expect(nodePinMismatch('v24.14.0', '22')).toBe('node v24.14.0 != v22.x');
  });

  it('tolerates trailing whitespace/newline in the pin file', () => {
    expect(nodePinMismatch('v22.23.1', '22\n')).toBeNull();
  });

  it('skips the check for an empty or whitespace-only pin', () => {
    expect(nodePinMismatch('v24.14.0', '')).toBeNull();
    expect(nodePinMismatch('v24.14.0', '  \n')).toBeNull();
    expect(nodePinMismatch('v24.14.0', null)).toBeNull();
  });

  it('does not treat v2 as satisfying a pin of 22 (prefix trap)', () => {
    expect(nodePinMismatch('v2.1.0', '22')).toBe('node v2.1.0 != v22.x');
  });

  it('defaults nvmrcPath to .nvmrc so Shipwright behaviour is unchanged', () => {
    expect(DEFAULT_CONFIG.nvmrcPath).toBe('.nvmrc');
  });

  it('lets a project relocate the pin, or opt out entirely', () => {
    expect(mergeConfig(DEFAULT_CONFIG, { nvmrcPath: 'ui/.nvmrc' }).nvmrcPath).toBe('ui/.nvmrc');
    expect(mergeConfig(DEFAULT_CONFIG, { nvmrcPath: null }).nvmrcPath).toBeNull();
  });
});

describe('conductor-lib: claimableTickets — --no-merge must terminate', () => {
  const plan = (...tickets) => ({ tickets });
  const T = (id, over = {}) => ({
    id, title: id, lane: id.split('-')[0], status: 'todo', depends_on: [], write_scope: [], acceptance: [], ...over,
  });

  it('returns claimable tickets in id order', () => {
    expect(claimableTickets(plan(T('S-02'), T('S-01'))).map((t) => t.id)).toEqual(['S-01', 'S-02']);
  });

  it('excludes a parked ticket so the run does not re-claim it forever', () => {
    const p = plan(T('S-01'), T('W8-03'));
    // The board still says todo — that is exactly the --no-merge situation.
    expect(claimableTickets(p).map((t) => t.id)).toEqual(['S-01', 'W8-03']);
    expect(claimableTickets(p, { excluded: ['S-01'] }).map((t) => t.id)).toEqual(['W8-03']);
  });

  it('drains to empty once every claimable ticket has been parked — the loop terminates', () => {
    const p = plan(T('S-01'), T('S-02', { lane: 'docs' }));
    expect(claimableTickets(p, { excluded: ['S-01', 'S-02'] })).toEqual([]);
  });

  it('still honours holdTickets, waves, deps and lane busy-ness', () => {
    const p = plan(
      T('S-01'),
      T('S-05'),
      T('W8-03', { lane: 'api' }),
      T('W8-04', { lane: 'ui', depends_on: ['W8-03'] }),
      T('W7-01', { lane: 'core' }),
      T('W6-01', { lane: 'busy' }),
      T('X-99', { lane: 'busy', status: 'in_progress' }),
    );
    const got = claimableTickets(p, { waves: ['S', 'W8', 'W6'], hold: ['S-05'] }).map((t) => t.id);
    expect(got).toEqual(['S-01', 'W8-03']); // S-05 held, W7 out of wave, W8-04 dep unmet, W6-01 lane busy
  });

  it('a satisfied dependency unblocks its dependent', () => {
    const p = plan(T('W8-03', { status: 'done' }), T('W8-04', { lane: 'ui', depends_on: ['W8-03'] }));
    expect(claimableTickets(p).map((t) => t.id)).toEqual(['W8-04']);
  });

  it('tolerates a ticket with no depends_on field', () => {
    const t = T('S-01'); delete t.depends_on;
    expect(claimableTickets(plan(t)).map((x) => x.id)).toEqual(['S-01']);
  });
});

describe('conductor-lib: testSiblingWarning — a ticket must be able to write its own tests', () => {
  const GO = { source: '\\.go$', test: '_test\\.go$' };
  const T = (scope) => ({ id: 'W6-01', write_scope: scope });

  it('warns when implementation is in scope but no test sibling is', () => {
    const w = testSiblingWarning(T(['internal/bootstrap/ha_coordinator.go']), GO);
    expect(w).toMatch(/no test sibling/);
    expect(w).toContain('ha_coordinator.go');
  });

  it('is quiet once the test sibling is in scope', () => {
    expect(testSiblingWarning(
      T(['internal/bootstrap/ha_coordinator.go', 'internal/bootstrap/ha_coordinator_test.go']), GO,
    )).toBeNull();
  });

  it('is quiet for a docs- or config-only ticket', () => {
    expect(testSiblingWarning(T(['docs/DATABASE.md', 'nginx.conf']), GO)).toBeNull();
  });

  it('is quiet for a test-only ticket', () => {
    expect(testSiblingWarning(T(['internal/bootstrap/ha_coordinator_test.go']), GO)).toBeNull();
  });

  it('is off entirely when the project sets no testSibling config', () => {
    expect(testSiblingWarning(T(['x.go']), null)).toBeNull();
    expect(testSiblingWarning(T(['x.go']), {})).toBeNull();
  });

  it('handles a ticket with no write_scope', () => {
    expect(testSiblingWarning({ id: 'X-1' }, GO)).toBeNull();
  });
});

describe('conductor-lib: migrationCollisions — two tickets must not share a version', () => {
  const CFG = { pattern: '/(\\d{6})_' };
  const T = (id, status, ...scope) => ({ id, status, write_scope: scope });
  const M = (n, name) => `internal/db/migrations/postgres/${n}_${name}.up.sql`;

  it('flags two open tickets claiming the same version', () => {
    const out = migrationCollisions([T('S-25','todo',M('000030','a')), T('W6-02','blocked',M('000030','b'))], CFG);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('000030');
    expect(out[0]).toContain('silently overwrite');
  });

  it('flags an open ticket claiming a version already on disk', () => {
    const out = migrationCollisions([T('W5-05','todo',M('000027','x'))], CFG, ['000027']);
    expect(out[0]).toContain('already exists on disk');
  });

  it('does NOT flag a done ticket whose migration is legitimately on disk', () => {
    expect(migrationCollisions([T('W9-04','done',M('000027','x'))], CFG, ['000027'])).toEqual([]);
  });

  it('does NOT flag several done tickets sharing a historical version', () => {
    expect(migrationCollisions([T('S-20','done',M('000027','x')), T('W9-04','done',M('000027','y'))], CFG, ['000027'])).toEqual([]);
  });

  it('is quiet when every open ticket has its own free version', () => {
    expect(migrationCollisions([T('A-1','todo',M('000033','a')), T('B-2','todo',M('000034','b'))], CFG, ['000029'])).toEqual([]);
  });

  // Regression, Kryptkeeper 2026-07-29: the rule keyed only on the version number,
  // so two tickets deliberately SHARING one migration file read as a collision.
  // W9-04 and S-20 both legitimately claim 000027_ca_key_rotations — one file, two
  // owners — and the board linter cried collision on every run. A version is only
  // dangerous when it resolves to more than one distinct migration FILE.
  it('does NOT flag two tickets that share one migration file (same version, same name)', () => {
    const out = migrationCollisions(
      [T('W9-04','todo',M('000027','ca_key_rotations')), T('S-20','todo',M('000027','ca_key_rotations'))],
      CFG,
    );
    expect(out).toEqual([]);
  });

  it('still flags two tickets at one version when the filenames differ', () => {
    const out = migrationCollisions(
      [T('W9-04','todo',M('000027','ca_key_rotations')), T('S-20','todo',M('000027','something_else'))],
      CFG,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('000027');
  });

  it('treats the up/down pair of one migration as a single file, not two', () => {
    const pair = (n, name) => [
      `internal/db/migrations/postgres/${n}_${name}.up.sql`,
      `internal/db/migrations/postgres/${n}_${name}.down.sql`,
    ];
    expect(migrationCollisions([T('A-1','todo',...pair('000030','a'))], CFG)).toEqual([]);
  });

  it('ignores non-migration paths and is off without config', () => {
    expect(migrationCollisions([T('A-1','todo','internal/x.go')], CFG)).toEqual([]);
    expect(migrationCollisions([T('A-1','todo',M('000030','a')), T('B','todo',M('000030','b'))], null)).toEqual([]);
  });
});

describe('conductor-lib: reviewDecision — a FIX verdict with no blockers must not spin', () => {
  const HIGH = { severity: 'HIGH', file: 'a.ts', issue: 'boom', fix: 'do x' };
  const MED  = { severity: 'MEDIUM', file: 'b.ts', issue: 'meh', fix: 'maybe' };

  // Kryptkeeper S-30, 2026-07-29: reviewer returned FIX, raised nothing above
  // MEDIUM, so blockers came out empty. The loop retried the agent with an empty
  // gap list — fix nothing — and on attempt exhaustion would have blocked the
  // ticket with an empty ledger.
  it('approves a FIX verdict that carries no CRITICAL/HIGH and no still-present priors', () => {
    const d = reviewDecision({ verdict: 'FIX', findings: [], prior_status: [] });
    expect(d.approve).toBe(true);
    expect(d.blockers).toEqual([]);
    expect(d.verdictOverridden).toBe(true);
  });

  it('approves a FIX verdict carrying only sub-blocking findings, and keeps them as advisory', () => {
    const d = reviewDecision({ verdict: 'FIX', findings: [MED], prior_status: [] });
    expect(d.approve).toBe(true);
    expect(d.advisory).toHaveLength(1);
    expect(d.verdictOverridden).toBe(true);
  });

  it('still blocks on a CRITICAL/HIGH finding', () => {
    const d = reviewDecision({ verdict: 'FIX', findings: [HIGH], prior_status: [] });
    expect(d.approve).toBe(false);
    expect(d.blockers).toHaveLength(1);
    expect(d.blockers[0]).toContain('boom');
    expect(d.verdictOverridden).toBe(false);
  });

  it('still blocks on a prior finding the reviewer marks STILL PRESENT, even on APPROVE', () => {
    const d = reviewDecision({ verdict: 'APPROVE', findings: [], prior_status: [{ status: 'PRESENT', finding: 'old leak', evidence: 'line 9' }] });
    expect(d.approve).toBe(false);
    expect(d.blockers[0]).toContain('STILL-PRESENT');
  });

  it('does not mark an ordinary APPROVE as overridden', () => {
    const d = reviewDecision({ verdict: 'APPROVE', findings: [MED], prior_status: [] });
    expect(d.approve).toBe(true);
    expect(d.verdictOverridden).toBe(false);
  });

  it('survives a malformed or empty verdict without throwing', () => {
    for (const v of [null, undefined, {}, { findings: null, prior_status: 'nope' }]) {
      const d = reviewDecision(v);
      expect(d.approve).toBe(true);
      expect(d.blockers).toEqual([]);
    }
  });
});

describe('conductor-lib: selectGates — do not gate a backend ticket on a frontend suite', () => {
  const GO = ['go', ['build', './...']];
  const UI = { cmd: 'npm', args: ['--prefix', 'ui', 'run', 'test'], when: ['ui/**'] };

  // Kryptkeeper S-32, 2026-07-29: write_scope was internal/bootstrap/* plus
  // tests/smoke/**, not one ui/ path, and it failed twice on a flaky ui vitest
  // run while an unrelated opengrep scan had the box at load 155.
  it('skips a scoped gate when the ticket touches nothing it covers', () => {
    const t = { write_scope: ['internal/bootstrap/response.go', 'tests/smoke/**'] };
    const { run, skipped } = selectGates([GO, UI], t);
    expect(run).toEqual([GO]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].cmd).toBe('npm');
  });

  it('runs the scoped gate when the ticket does touch that area', () => {
    const t = { write_scope: ['ui/src/pages/Keys.tsx'] };
    const { run, skipped } = selectGates([GO, UI], t);
    expect(run).toHaveLength(2);
    expect(skipped).toEqual([]);
  });

  it('treats a legacy [cmd, args] tuple as unconditional', () => {
    const t = { write_scope: ['docs/README.md'] };
    expect(selectGates([GO], t).run).toEqual([GO]);
  });

  it('treats an object gate with no when as unconditional', () => {
    const t = { write_scope: ['docs/README.md'] };
    const g = { cmd: 'make', args: ['lint'] };
    expect(selectGates([g], t).run).toEqual([['make', ['lint']]]);
  });

  it('matches a glob-style scope entry, not just literal paths', () => {
    const t = { write_scope: ['ui/src/**'] };
    expect(selectGates([UI], t).run).toHaveLength(1);
  });

  it('survives a ticket with no write_scope and an empty gate list', () => {
    expect(selectGates([UI], {}).run).toEqual([]);
    expect(selectGates(undefined, { write_scope: ['x'] }).run).toEqual([]);
  });
});

describe('conductor-lib: pageMountWarning — a new UI page must be mountable', () => {
  const CFG = {
    page: '^ui/src/pages/.*\\.tsx$',
    mounts: ['ui/src/App.tsx', 'ui/src/lib/nav.ts'],
    writes: 'configur|set |writes|in-app',
    writeMounts: ['ui/src/lib/api.ts'],
  };

  // Kryptkeeper W8-04 and W8-07, 2026-07-29/30: both filed as a lone page file,
  // both blocked for the same reason. The first fix lived in a note, so it
  // taught nobody and the second ticket repeated it.
  it('flags a lone page file with no route or nav', () => {
    const w = pageMountWarning({ id: 'W8-07', write_scope: ['ui/src/pages/RenewalPolicy.tsx'] }, CFG);
    expect(w).toContain('ui/src/App.tsx');
    expect(w).toContain('ui/src/lib/nav.ts');
  });

  it('is silent once route and nav are in scope', () => {
    expect(pageMountWarning({
      id: 'W8-07',
      write_scope: ['ui/src/pages/RenewalPolicy.tsx', 'ui/src/App.tsx', 'ui/src/lib/nav.ts'],
    }, CFG)).toBeNull();
  });

  it('additionally demands the API client when the page writes', () => {
    const w = pageMountWarning({
      id: 'W8-07',
      write_scope: ['ui/src/pages/RenewalPolicy.tsx', 'ui/src/App.tsx', 'ui/src/lib/nav.ts'],
      acceptance: ['set auto-renew threshold per target in-app'],
    }, CFG);
    expect(w).toContain('ui/src/lib/api.ts');
  });

  it('does not demand the API client for a read-only page', () => {
    expect(pageMountWarning({
      id: 'X-1',
      write_scope: ['ui/src/pages/Report.tsx', 'ui/src/App.tsx', 'ui/src/lib/nav.ts'],
      acceptance: ['renders a chart of issuance over time'],
    }, CFG)).toBeNull();
  });

  it('ignores a ticket that touches no page', () => {
    expect(pageMountWarning({ id: 'S-34', write_scope: ['internal/bootstrap/auth.go'] }, CFG)).toBeNull();
  });

  it('is off when the project sets no config, and survives a scopeless ticket', () => {
    expect(pageMountWarning({ id: 'X', write_scope: ['ui/src/pages/A.tsx'] }, null)).toBeNull();
    expect(pageMountWarning({ id: 'X' }, CFG)).toBeNull();
  });
});
