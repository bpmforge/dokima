/**
 * SECURITY TRIAGE (sec/receipt-triage, not merged): pinning tests for the
 * W8-01 dogfood finding "export bundle import does not verify receipt
 * signatures."
 *
 * Two things are demonstrated here:
 *
 * 1. Receipt *content* tampering that keeps a stale-but-real anchoring MAC
 *    is rejected at import (`findUnanchoredReceiptIds` recomputes the MAC
 *    from the bundle's own receipt fields, so any field covered by
 *    `computeReceiptMac` — including `verifyExit` — cannot be edited without
 *    invalidating the anchor). This is the forgery case the 11 findings
 *    describe ("attacker without signingKey POSTs a bundle with a fabricated
 *    receipt") and it is already closed.
 *
 * 2. The one real gap the caveat in docs/STATUS.md names: import only
 *    replays "part 1" of `verifyReceipt` (the anchor MAC). It does not
 *    replay part 4, the waiver FR-P2 re-check (signedBy resolves to a
 *    *current* human, non-blocklisted identity). A bundle can carry a
 *    genuinely-anchored waiver receipt (valid MAC, real signingKey) paired
 *    with a tampered `identities` entry for the same signedBy id that
 *    claims a different kind/name than the source project had at mint time.
 *    Import accepts this — proving the caveat is real. But it is inert: the
 *    only place waiver validity is ever *acted on* (packages/pipeline's
 *    `advance`/`staleness`, packages/harbormaster's `resume`) calls the
 *    full `verifyReceipt` against the target project's live identities
 *    table, which immediately re-fails the tampered waiver on FR-P2. So the
 *    gap lets an internally-inconsistent bundle land in the DB; it does not
 *    let an attacker manufacture a usable agent-signed waiver.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createIdentity,
  mintReceipt,
  openEventLog,
  verifyReceipt,
} from '@shipwright/events';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAllowlist } from './allowlist.js';
import { registerExportRoutes } from './export-routes.js';
import { registerProject } from './projects.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4602;
const SIGNING_KEY = 'test-minting-secret';

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function authHeaders() {
  return { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };
}

describe('receipt anchor triage (sec/receipt-triage)', () => {
  const dirs: string[] = [];
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function boot(): Promise<{ app: FastifyInstance; fleetHome: string }> {
    const fleetHome = await tmpDir('shipwright-triage-fleet-');
    dirs.push(fleetHome);
    const app = Fastify({ logger: false });
    registerExportRoutes(app, {
      home: fleetHome,
      auth: { token: TOKEN, allowlist: buildAllowlist(PORT) },
      signingKey: SIGNING_KEY,
    });
    await app.ready();
    apps.push(app);
    return { app, fleetHome };
  }

  it(
    'import rejects a bundle whose receipt content was edited but whose anchoring MAC ' +
      'was left at the old (pre-edit) value — proves the anchor covers every content ' +
      'field, not just receipt/event presence',
    async () => {
      const { app, fleetHome } = await boot();
      const projectDir = await tmpDir('shipwright-triage-tamper-src-');
      dirs.push(projectDir);
      const registryPath = path.join(fleetHome, 'fleet.json');
      const record = await registerProject(registryPath, {
        path: projectDir,
        mode: 'new',
        name: 'triage-tamper-src',
      });

      const log = openEventLog(path.join(projectDir, '.shipwright', 'state.db'));
      createIdentity(log, { id: 'maker-1', name: 'Maker', kind: 'machine' });
      mintReceipt(
        log,
        {
          id: 'rcpt-close-1',
          kind: 'close',
          projectId: record.id,
          validators: [{ name: 'validate-plan', exitCode: 0, gapCount: 0 }],
          inputFiles: [{ path: 'docs/SRS.md', content: 'v1' }],
          actorId: 'maker-1',
        },
        { signingKey: SIGNING_KEY },
      );
      log.close();

      const exportRes = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${record.id}/export`,
        headers: authHeaders(),
      });
      const bundle = exportRes.json();
      expect(bundle.receipts).toHaveLength(1);

      // Attacker (no signingKey) flips a validator's exitCode from 1 to 0 to
      // make a failing gate look like it passed, without touching the
      // anchoring event at all.
      const tampered = JSON.parse(bundle.receipts[0].validatorsJson);
      tampered[0].exitCode = 999;
      bundle.receipts[0].validatorsJson = JSON.stringify(tampered);

      const targetDir = await tmpDir('shipwright-triage-tamper-dst-');
      dirs.push(targetDir);
      const targetRecord = await registerProject(registryPath, {
        path: targetDir,
        mode: 'new',
        name: 'triage-tamper-dst',
      });

      const importRes = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${targetRecord.id}/import`,
        headers: authHeaders(),
        payload: bundle,
      });

      expect(importRes.statusCode).toBe(400);
      expect(importRes.json().detail).toMatch(/no valid anchoring event/);
      expect(importRes.json().evidence.unanchored_receipt_ids).toEqual(['rcpt-close-1']);
    },
  );

  it(
    'GAP (inert): import accepts a genuinely-anchored waiver receipt paired with a ' +
      "tampered identities[] entry that contradicts the signer's kind at mint time " +
      '— part 4 (FR-P2 re-check) of verifyReceipt is not replayed at import — but the ' +
      "receipt still fails a real, full verifyReceipt call once it's in the target " +
      'DB, so the gap cannot be used to make an agent-signed waiver pass a real gate',
    async () => {
      const { app, fleetHome } = await boot();
      const projectDir = await tmpDir('shipwright-triage-waiver-src-');
      dirs.push(projectDir);
      const registryPath = path.join(fleetHome, 'fleet.json');
      const record = await registerProject(registryPath, {
        path: projectDir,
        mode: 'new',
        name: 'triage-waiver-src',
      });

      const log = openEventLog(path.join(projectDir, '.shipwright', 'state.db'));
      createIdentity(log, { id: 'maker-1', name: 'Maker', kind: 'machine' });
      createIdentity(log, { id: 'human-alice', name: 'Alice', kind: 'human' });
      // Genuine mint: mintReceipt enforces FR-P2 at mint time (signer must
      // resolve to kind === 'human' and not match the agent-name
      // blocklist), so this anchoring event + contentMac is 100% real.
      mintReceipt(
        log,
        {
          id: 'rcpt-waiver-1',
          kind: 'waiver',
          projectId: record.id,
          validators: [],
          inputFiles: [],
          actorId: 'maker-1',
          signedBy: 'human-alice',
        },
        { signingKey: SIGNING_KEY },
      );
      log.close();

      const exportRes = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${record.id}/export`,
        headers: authHeaders(),
      });
      const bundle = exportRes.json();
      expect(bundle.receipts).toHaveLength(1);
      expect(bundle.receipts[0].signedBy).toBe('human-alice');

      // Tamper ONLY the identities[] entry — not covered by the receipt's
      // contentMac — to claim "human-alice" is actually an agent, using a
      // name that matches DEFAULT_AGENT_NAME_BLOCKLIST.
      const aliceIndex = bundle.identities.findIndex(
        (i: { id: string }) => i.id === 'human-alice',
      );
      expect(aliceIndex).toBeGreaterThanOrEqual(0);
      bundle.identities[aliceIndex] = {
        ...bundle.identities[aliceIndex],
        kind: 'machine',
        name: 'claude-bot',
      };

      const targetDir = await tmpDir('shipwright-triage-waiver-dst-');
      dirs.push(targetDir);
      const targetRecord = await registerProject(registryPath, {
        path: targetDir,
        mode: 'new',
        name: 'triage-waiver-dst',
      });

      const importRes = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${targetRecord.id}/import`,
        headers: authHeaders(),
        payload: bundle,
      });

      // The gap: import ACCEPTS this internally-inconsistent bundle. If
      // this assertion ever starts failing (import starts rejecting it),
      // the caveat is closed and this test should be rewritten to assert
      // the rejection instead.
      expect(importRes.statusCode).toBe(201);

      // But the gap is inert: a real, full verifyReceipt call against the
      // now-imported target DB (as packages/pipeline's advance/staleness
      // and packages/harbormaster's resume always do before acting on a
      // waiver) still catches it via FR-P2, using the target's *current*
      // (tampered) identities table.
      const targetLog = openEventLog(path.join(targetDir, '.shipwright', 'state.db'));
      const result = verifyReceipt(targetLog, 'rcpt-waiver-1', {
        signingKey: SIGNING_KEY,
        inputFiles: [],
        requiredValidators: [],
      });
      targetLog.close();

      expect(result.valid).toBe(false);
      expect(result.reasons.some((r) => /human signature|blocklist/.test(r))).toBe(true);
    },
  );
});
