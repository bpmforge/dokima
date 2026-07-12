import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FitnessFixtureError,
  loadFixtureTasks,
  loadFixtureTasksForRole,
} from './fixtures.js';

describe('loadFixtureTasks (the real e2e/fitness-fixtures/ set)', () => {
  it('loads all three acceptance-named roles with a well-formed task each', () => {
    const tasks = loadFixtureTasks();
    const byRole = new Map(tasks.map((t) => [t.role, t]));
    expect(byRole.has('coding-agent')).toBe(true);
    expect(byRole.has('code-reviewer')).toBe(true);
    expect(byRole.has('challenger')).toBe(true);
    for (const task of tasks) {
      expect(task.id).toEqual(expect.any(String));
      expect(task.prompt.length).toBeGreaterThan(0);
      expect(['keyword', 'function-behavior']).toContain(task.oracle.kind);
    }
  });

  it('the coding-agent task uses a real executable oracle, not keyword matching', () => {
    const [codingTask] = loadFixtureTasksForRole('coding-agent');
    expect(codingTask?.oracle.kind).toBe('function-behavior');
  });

  it('is deterministically sorted by filename', () => {
    const first = loadFixtureTasks().map((t) => t.id);
    const second = loadFixtureTasks().map((t) => t.id);
    expect(first).toEqual(second);
  });
});

describe('loadFixtureTasksForRole', () => {
  it('returns an empty array for a role with no fixture task', () => {
    expect(loadFixtureTasksForRole('test-engineer')).toEqual([]);
  });
});

describe('fixture parsing against a synthetic directory', () => {
  let dir: string;

  function withDir<T>(files: Record<string, string>, run: () => T): T {
    dir = mkdtempSync(path.join(tmpdir(), 'fitness-fixtures-'));
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), contents, 'utf8');
    }
    try {
      return run();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('throws FitnessFixtureError on invalid JSON, naming the file', () => {
    withDir({ 'bad.json': '{ not valid json' }, () => {
      expect(() => loadFixtureTasks(dir)).toThrow(FitnessFixtureError);
      try {
        loadFixtureTasks(dir);
      } catch (err) {
        expect((err as FitnessFixtureError).file).toBe('bad.json');
      }
    });
  });

  it('throws FitnessFixtureError when a required field is missing', () => {
    withDir(
      { 'incomplete.json': JSON.stringify({ id: 'x', role: 'coding-agent' }) },
      () => {
        expect(() => loadFixtureTasks(dir)).toThrow(FitnessFixtureError);
      },
    );
  });

  it('ignores non-json files in the directory', () => {
    withDir(
      {
        'README.md': '# not a fixture',
        'ok.json': JSON.stringify({
          id: 'x',
          role: 'coding-agent',
          description: 'd',
          prompt: 'p',
          oracle: { kind: 'keyword', requireAll: [] },
        }),
      },
      () => {
        expect(loadFixtureTasks(dir)).toHaveLength(1);
      },
    );
  });
});
