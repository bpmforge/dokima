/**
 * Proves `packages/shared/src/export/hash-chain.ts`'s algorithm mirror
 * agrees, byte-for-byte, with the authoritative `packages/events/src/
 * hash.ts` it was hand-copied from (that file's own header explains why:
 * `packages/shared` cannot depend on `packages/events`, ARCHITECTURE.md §4).
 * Without this, the two copies could silently drift — a bundle a real
 * project (hashed by `@dokima/events`) exports would then fail the
 * "portable, SQLite-free" verifier's own chain check, defeating its reason
 * to exist.
 *
 * `packages/shared/src/export` is not wired into that package's root
 * barrel yet (see its own `index.ts` header — out of this ticket's
 * write_scope), so it can't be reached via the normal `@dokima/shared`
 * specifier. Loaded here by absolute `file://` URL instead — the same
 * dynamic-import technique `apps/web/e2e/fixtures/seed-board-tickets.mjs`
 * uses to reach a workspace package its own `package.json` doesn't declare,
 * confirmed to work inside vitest too, not just standalone `tsx` scripts.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  computeEventHash,
  verifyChain,
  GENESIS_HASH,
  type ChainRow,
} from '@dokima/events';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

async function loadSharedHashChain() {
  const url = pathToFileURL(
    path.join(repoRoot, 'packages', 'shared', 'src', 'export', 'hash-chain.ts'),
  ).href;
  return import(url) as Promise<{
    computeBundleEventHash: typeof computeEventHash;
    verifyBundleChain: typeof verifyChain;
    GENESIS_HASH: string;
  }>;
}

describe('packages/shared/src/export/hash-chain.ts parity with packages/events/src/hash.ts', () => {
  it('GENESIS_HASH is identical', async () => {
    const shared = await loadSharedHashChain();
    expect(shared.GENESIS_HASH).toBe(GENESIS_HASH);
  });

  it('computeBundleEventHash matches computeEventHash for the same inputs', async () => {
    const shared = await loadSharedHashChain();
    const samples = [
      {
        prevHash: GENESIS_HASH,
        seq: 1,
        eventType: 'ticket.created',
        actorId: 'a',
        payloadJson: '{}',
      },
      {
        prevHash: 'f'.repeat(64),
        seq: 42,
        eventType: 'gate.receipt_minted',
        actorId: 'maker-1',
        payloadJson: '{"n":1,"nested":{"x":"y"}}',
      },
      { prevHash: GENESIS_HASH, seq: 1, eventType: '', actorId: '', payloadJson: '' },
    ];
    for (const input of samples) {
      expect(shared.computeBundleEventHash(input)).toBe(computeEventHash(input));
    }
  });

  it('verifyBundleChain and verifyChain agree on a well-formed chain', async () => {
    const shared = await loadSharedHashChain();
    const rows: ChainRow[] = [];
    let prevHash = GENESIS_HASH;
    for (const [seq, eventType] of [
      [1, 'ticket.created'],
      [2, 'ticket.claimed'],
      [3, 'ticket.closed'],
    ] as const) {
      const row = { prevHash, seq, eventType, actorId: 'a', payloadJson: `{"n":${seq}}` };
      const hash = computeEventHash(row);
      rows.push({ ...row, hash });
      prevHash = hash;
    }

    const eventsShaped = rows.map((r) => ({
      seq: r.seq,
      eventType: r.eventType,
      actorId: r.actorId,
      ticketId: null,
      runId: null,
      payloadJson: r.payloadJson,
      createdAt: '2026-01-01T00:00:00.000Z',
      prevHash: r.prevHash,
      hash: r.hash,
    }));

    expect(verifyChain(rows)).toEqual({ valid: true, brokenAtSeq: null, reason: null });
    expect(shared.verifyBundleChain(eventsShaped)).toEqual(verifyChain(rows));
  });

  it('verifyBundleChain and verifyChain agree on a tampered chain (same broken seq)', async () => {
    const shared = await loadSharedHashChain();
    const rows: ChainRow[] = [];
    let prevHash = GENESIS_HASH;
    for (const [seq, eventType] of [
      [1, 'ticket.created'],
      [2, 'ticket.claimed'],
    ] as const) {
      const row = { prevHash, seq, eventType, actorId: 'a', payloadJson: `{"n":${seq}}` };
      const hash = computeEventHash(row);
      rows.push({ ...row, hash });
      prevHash = hash;
    }
    rows[1] = { ...rows[1]!, payloadJson: '{"n":999}' };

    const eventsShaped = rows.map((r) => ({
      seq: r.seq,
      eventType: r.eventType,
      actorId: r.actorId,
      ticketId: null,
      runId: null,
      payloadJson: r.payloadJson,
      createdAt: '2026-01-01T00:00:00.000Z',
      prevHash: r.prevHash,
      hash: r.hash,
    }));

    const eventsResult = verifyChain(rows);
    const sharedResult = shared.verifyBundleChain(eventsShaped);
    expect(eventsResult.valid).toBe(false);
    expect(sharedResult).toEqual(eventsResult);
  });
});
