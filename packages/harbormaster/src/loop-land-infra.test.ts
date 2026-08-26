/**
 * W21-13. An infra retry that says only "endpoint_failure" leaves an operator
 * unable to tell a timeout from a refused connection from a 500 — and those
 * point at completely different fixes. These fixtures pin that the provider's
 * own words reach the ledger, and that they are redacted on the way.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { createFreeRetryGate } from './loop-land-infra.js';
import type { LandLoopOptions } from './loop-land.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function harness(): { log: EventLog; options: LandLoopOptions } {
  const target = mkdtempSync(path.join(os.tmpdir(), 'infra-'));
  dirs.push(target);
  const log = openEventLog(path.join(target, 'state.db'));
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'machine' });
  return { log, options: { log, actorId: 'operator' } as unknown as LandLoopOptions };
}


describe('an infra retry says WHY (W21-13)', () => {
  it('RED FIXTURE: the ledgered event carries the provider message, not just the category', () => {
    const { log, options } = harness();
    const gate = createFreeRetryGate(options, 'T-1', 2);
    const took = gate.take(
      'endpoint_failure',
      1,
      'provider failure: lm-studio: request timed out after 300000ms',
    );
    expect(took).toBe(true);
    const rows = log.db
      .prepare("select payload from events where event_type = 'session.infra_retry'")
      .all() as { payload: string }[];
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]!.payload) as Record<string, unknown>;
    expect(payload.kind).toBe('endpoint_failure');
    // The half that was missing: an operator can now tell a timeout from a
    // refused connection without guessing.
    expect(String(payload.reason)).toContain('timed out after 300000ms');
    log.close();
  });

  it('a provider error that echoes a secret is redacted before it is ledgered', () => {
    const { log, options } = harness();
    const gate = createFreeRetryGate(options, 'T-1', 2);
    gate.take('endpoint_failure', 1, 'provider failure: bad key sk-abcdefghijklmnopqrstuvwxyz012345');
    const row = log.db
      .prepare("select payload from events where event_type = 'session.infra_retry'")
      .get() as { payload: string };
    expect(row.payload).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    log.close();
  });

  it('no detail is still a valid retry — the category alone must not crash it', () => {
    const { log, options } = harness();
    const gate = createFreeRetryGate(options, 'T-1', 2);
    expect(gate.take('endpoint_failure', 1)).toBe(true);
    const row = log.db
      .prepare("select payload from events where event_type = 'session.infra_retry'")
      .get() as { payload: string };
    expect(JSON.parse(row.payload)).not.toHaveProperty('reason');
    log.close();
  });
});
