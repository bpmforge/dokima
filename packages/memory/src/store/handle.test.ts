import { describe, expect, it } from 'vitest';
import { createTestHandle } from './test-helpers.js';

describe('SqliteHandle DI seam', () => {
  it('a node:sqlite DatabaseSync satisfies the structural handle contract', () => {
    const handle = createTestHandle();
    handle.exec(
      "INSERT INTO facts (kind, content, confidence, created_at) VALUES ('fact', 'x', 0.5, '2026-01-01T00:00:00.000Z')",
    );
    const row = handle
      .prepare<{ content: string }>('SELECT content FROM facts WHERE id = ?')
      .get(1);
    expect(row?.content).toBe('x');
    const rows = handle.prepare<{ content: string }>('SELECT content FROM facts').all();
    expect(rows).toHaveLength(1);
  });

  it('009_memory.sql tables exist on a fresh handle', () => {
    const handle = createTestHandle();
    const tables = handle
      .prepare<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining(['facts', 'facts_fts', 'calibration', 'working_findings']),
    );
  });
});
