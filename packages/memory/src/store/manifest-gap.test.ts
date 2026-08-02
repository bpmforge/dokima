/**
 * R-G2 proof (the v2.5.0 library lesson: 44/45 agents silently skipped
 * write-back until it was manifest-gated). `packages/harbormaster`'s
 * `checkMemoryWritten` already landed inert, waiting for this ticket
 * (`loop-gates-secrets.ts`: "deferred until W7-01 lands"). `memory` can't
 * statically import `@dokima/harbormaster` (ARCHITECTURE.md §4 — the
 * dependency runs the other way), so this dynamically imports the REAL
 * function by absolute `file://` URL, same technique as
 * `anti-jarvis-gap.test.ts`. Proves both directions: a manifest with no
 * `memory_written[]` trips the gap for a memory-eligible role, and real ids
 * from an actual store write clear it.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { insertFact } from './facts.js';
import type { SqliteHandle } from './handle.js';
import { createTestHandle } from './test-helpers.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

type CheckMemoryWritten = (
  manifest: Record<string, unknown>,
  role: string | undefined,
  memoryEligibleRoles: readonly string[],
) => string | null;

async function loadCheckMemoryWritten(): Promise<CheckMemoryWritten> {
  const mod = (await import(
    pathToFileURL(
      path.join(repoRoot, 'packages', 'harbormaster', 'src', 'loop-gates-secrets.ts'),
    ).href
  )) as { checkMemoryWritten: CheckMemoryWritten };
  return mod.checkMemoryWritten;
}

const NOW = () => '2026-07-20T12:00:00.000Z';

const BASE_MANIFEST = {
  ticket: 'W9-88',
  files: ['packages/example/file.ts'],
  verify: { command: 'pnpm test', exit: 0 },
  commits: ['abc1234'],
  evidence: [],
};

describe('R-G2: manifest_written[] gap (Completion Manifest x Harbormaster truth-check)', () => {
  it('is inert for a role not listed as memory-eligible', async () => {
    const checkMemoryWritten = await loadCheckMemoryWritten();
    const reason = checkMemoryWritten(BASE_MANIFEST, 'coder', ['memory-agent']);
    expect(reason).toBeNull();
  });

  it('trips the gap when a memory-eligible role has no memory_written[]', async () => {
    const checkMemoryWritten = await loadCheckMemoryWritten();
    const reason = checkMemoryWritten(BASE_MANIFEST, 'memory-agent', ['memory-agent']);
    expect(reason).not.toBeNull();
    expect(reason).toContain('memory_written');
  });

  it('trips the gap when memory_written[] is present but empty', async () => {
    const checkMemoryWritten = await loadCheckMemoryWritten();
    const manifest = { ...BASE_MANIFEST, memory_written: [] };
    const reason = checkMemoryWritten(manifest, 'memory-agent', ['memory-agent']);
    expect(reason).not.toBeNull();
  });

  it('clears the gap with real fact ids from an actual store write', async () => {
    const handle: SqliteHandle = createTestHandle();
    const fact = insertFact(
      handle,
      { kind: 'fact', content: 'a real memory write from this session', confidence: 0.8 },
      NOW,
    );

    const checkMemoryWritten = await loadCheckMemoryWritten();
    const manifest = { ...BASE_MANIFEST, memory_written: [`fact:${fact.id}`] };
    const reason = checkMemoryWritten(manifest, 'memory-agent', ['memory-agent']);
    expect(reason).toBeNull();
  });
});
