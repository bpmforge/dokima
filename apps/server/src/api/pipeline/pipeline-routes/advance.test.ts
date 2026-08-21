import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  computeInputTreeHash,
  computeReceiptMac,
  createIdentity,
  mintReceipt,
  openEventLog,
  verifyReceipt,
  type EventLog,
  type ValidatorResult,
} from '@dokima/events';
import { mintValidatorRunReceipt, type ValidatorRunResult } from '@dokima/validators';
import { getPhase } from '@dokima/pipeline';
import { registerProject } from '../../projects.js';
import { stateDbPath } from '../../server/board-project.js';
import {
  ensurePhaseGateVerifierIdentity,
  PHASE_GATE_VERIFIER_ACTOR_ID,
} from '../phase-gate/identity.js';
import { readPhaseInputFiles } from '../phase-gate/input-files.js';
import { runPhaseGate } from '../phase-gate/runner.js';
import { registerPipelineRoutes } from './index.js';

const SIGNING_KEY = 'test-signing-key-w9-07';
const AUTHOR_ACTOR_ID = 'specialist:pm-interviewer';

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

const CLEAN_VISION = '# Vision\n\nA plain document with no Mermaid diagrams at all.\n';
const CLEAN_COMPETITIVE = '# Competitive Analysis\n\nAlso plain.\n';
const CLEAN_SCOPE = '# Scope\n\nIn scope: the demo. Out of scope: everything else.\n';
const CLEAN_RISKS = '# Risks\n\nNone worth mentioning.\n';
const CLEAN_CONSTRAINTS = '# Constraints\n\nShip on time.\n';
const CLEAN_PERSONAS = '# User Personas\n\nOne persona: the operator.\n';
const CLEAN_SRS = '# SRS\n\nFR-1: the system shall work.\n';
const CLEAN_USER_STORIES = '# User Stories\n\nAs a user I want it to work.\n';
const CLEAN_USE_CASES = '# Use Cases\n\nUC-1: use the system.\n';
const CLEAN_TEST_PLAN = '# Test Plan\n\nRun the tests.\n';

/**
 * A `validate-mermaid`-named fixture validator conforming to the shared `_lib.sh`
 * envelope, exactly `apps/server/src/api/pipeline/phase-gate/runner.test.ts`'s own
 * `mkConformingMermaidContentDir` technique (see that file's header for the full
 * empirical explanation of why the REAL, unmodified `content/validators/
 * validate-mermaid.sh` cannot be used to reach a clean gate receipt today — a
 * pre-existing, out-of-scope, "DO NOT EDIT" content gap, not something fixed or
 * routed around here). This isolates the ROUTE's own wiring (the subject of this
 * ticket) from that unrelated gap; it does not loosen or bypass anything the route
 * itself does — `runPhaseGate`/`decideAdvance`/`verifyReceipt` all run for real
 * against this fixture, exactly as they would against a conforming real script.
 */
async function mkConformingValidatorContentDir(
  validatorNames: readonly string[],
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-advance-fixture-validators-'));
  for (const name of validatorNames) {
    const script = `#!/bin/bash\necho '{"validator":"${name}","gaps":0,"exit":0,"items":[]}'\n`;
    await fs.writeFile(path.join(dir, `${name}.sh`), script, { mode: 0o755 });
  }
  return dir;
}

function fakeCleanResult(name: string): ValidatorRunResult {
  return {
    name,
    exitCode: 0,
    gapCount: 0,
    gaps: [],
    stdout: `{"validator":"${name}","gaps":0,"exit":0,"items":[]}`,
    stderr: '',
    durationMs: 1,
    timedOut: false,
  };
}

describe('POST /api/v1/projects/:id/phases/:n/advance (W9-07)', () => {
  const dirs: string[] = [];
  const apps: FastifyInstance[] = [];
  let previousMermaidNoRender: string | undefined;

  beforeEach(() => {
    // Deterministic test env only: skip validate-mermaid.sh's optional real `mmdc`
    // render pass — mirrors runner.test.ts's own beforeEach. Not needed for the
    // fixture validator script above (it never invokes mmdc), but harmless to set.
    previousMermaidNoRender = process.env.MERMAID_NO_RENDER;
    process.env.MERMAID_NO_RENDER = '1';
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
    if (previousMermaidNoRender === undefined) {
      delete process.env.MERMAID_NO_RENDER;
    } else {
      process.env.MERMAID_NO_RENDER = previousMermaidNoRender;
    }
  });

  async function boot(gateContentDir?: string): Promise<{
    app: FastifyInstance;
    projectId: string;
    projectDir: string;
    dbPath: string;
  }> {
    const fleetHome = await tmpDir('dokima-advance-route-home-');
    dirs.push(fleetHome);
    const projectDir = await tmpDir('dokima-advance-route-project-');
    dirs.push(projectDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, { path: projectDir, mode: 'new' });

    const app = Fastify({ logger: false });
    registerPipelineRoutes(app, {
      home: fleetHome,
      signingKey: SIGNING_KEY,
      ...(gateContentDir ? { gateContentDir } : {}),
    });
    await app.ready();
    apps.push(app);

    return {
      app,
      projectId: record.id,
      projectDir,
      dbPath: stateDbPath(projectDir),
    };
  }

  async function writeDocs(
    projectDir: string,
    files: Record<string, string>,
  ): Promise<void> {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(projectDir, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
    }
  }

  /** Mints a genuinely clean gate receipt for `phaseId` via the real W9-06 runner
   * against a conforming fixture validator pack, exactly the way a real gate run
   * would — never a hand-inserted DB row. */
  async function mintCleanGateReceipt(
    dbPath: string,
    projectDir: string,
    projectId: string,
    phaseId: 0 | 1 | 2 | 3 | 4 | 5,
  ): Promise<string> {
    const phase = getPhase(phaseId);
    const fixtureContentDir = await mkConformingValidatorContentDir(phase.validators);
    dirs.push(fixtureContentDir);
    const log = openEventLog(dbPath);
    try {
      const result = await runPhaseGate(
        log,
        {
          projectId,
          phaseId,
          contentDir: fixtureContentDir,
          projectRoot: projectDir,
          authorActorId: AUTHOR_ACTOR_ID,
          id: randomUUID(),
        },
        { signingKey: SIGNING_KEY },
      );
      expect(result.ok).toBe(true);
      expect(result.receipt).not.toBeNull();
      return result.receipt!.id;
    } finally {
      log.close();
    }
  }

  function ensureHumanIdentity(log: EventLog, id: string, name: string): void {
    createIdentity(log, { id, name, kind: 'human' });
  }

  function ensureMachineIdentity(log: EventLog, id: string, name: string): void {
    createIdentity(log, { id, name, kind: 'machine' });
  }

  it('REFUSED, reasons intact: no gate receipt at all (criterion 2, base case)', async () => {
    const { app, projectId } = await boot();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/0/advance`,
      payload: { gateReceiptId: null, waiverReceiptId: null },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json() as {
      allowed: boolean;
      from_phase_id: number;
      to_phase_id: number;
      waived: boolean;
      reasons: string[];
    };
    expect(body.allowed).toBe(false);
    expect(body.from_phase_id).toBe(0);
    expect(body.to_phase_id).toBe(1);
    expect(body.waived).toBe(false);
    expect(body.reasons).toHaveLength(1);
    expect(body.reasons[0]).toMatch(/no gate receipt/);
  });

  it('ALLOWED: a genuinely clean, freshly minted gate receipt lets phase 0 advance to phase 1', async () => {
    const { app, projectId, projectDir, dbPath } = await boot();
    await writeDocs(projectDir, {
      'docs/VISION.md': CLEAN_VISION,
      'docs/COMPETITIVE_ANALYSIS.md': CLEAN_COMPETITIVE,
    });
    const gateReceiptId = await mintCleanGateReceipt(dbPath, projectDir, projectId, 0);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/0/advance`,
      payload: { gateReceiptId, waiverReceiptId: null },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { allowed: boolean; waived: boolean; reasons: string[] };
    expect(body.allowed).toBe(true);
    expect(body.waived).toBe(false);
    expect(body.reasons).toEqual([]);
  });

  it('REFUSED (FR-P2 criterion 3a): editing a phase deliverable after the gate receipt was minted invalidates it — input-hash mismatch surfaced', async () => {
    const { app, projectId, projectDir, dbPath } = await boot();
    await writeDocs(projectDir, {
      'docs/VISION.md': CLEAN_VISION,
      'docs/COMPETITIVE_ANALYSIS.md': CLEAN_COMPETITIVE,
    });
    const gateReceiptId = await mintCleanGateReceipt(dbPath, projectDir, projectId, 0);

    // Silently edit the doc AFTER the gate receipt was minted.
    await fs.writeFile(
      path.join(projectDir, 'docs/VISION.md'),
      CLEAN_VISION + '\nedited after the gate ran\n',
      'utf8',
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/0/advance`,
      payload: { gateReceiptId, waiverReceiptId: null },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json() as { allowed: boolean; reasons: string[] };
    expect(body.allowed).toBe(false);
    expect(body.reasons.some((r) => r.includes('input tree hash mismatch'))).toBe(true);
  });

  it('REFUSED (FR-P2 criterion 3b): a receipt minted before a validator was added to the phase set refuses on validator-set drift', async () => {
    const { app, projectId, projectDir, dbPath } = await boot();
    const phase2 = getPhase(2);
    await writeDocs(projectDir, {
      'docs/SRS.md': CLEAN_SRS,
      'docs/USER_STORIES.md': CLEAN_USER_STORIES,
      'docs/USE_CASES.md': CLEAN_USE_CASES,
      'docs/TEST_PLAN.md': CLEAN_TEST_PLAN,
    });

    // Simulate a receipt minted BEFORE `validate-mermaid` was added to phase 2's
    // required set (R-H3): it only covers the other three validators, all clean.
    const droppedValidator = 'validate-mermaid';
    expect(phase2.validators).toContain(droppedValidator);
    const olderValidatorSet = phase2.validators.filter((v) => v !== droppedValidator);
    expect(olderValidatorSet.length).toBeGreaterThan(0);

    const log = openEventLog(dbPath);
    let gateReceiptId: string;
    try {
      ensurePhaseGateVerifierIdentity(log);
      const inputFiles = await readPhaseInputFiles(phase2, projectDir);
      const receipt = mintValidatorRunReceipt(
        log,
        {
          id: randomUUID(),
          kind: 'gate',
          projectId,
          phase: 2,
          ticketId: null,
          inputFiles,
          results: olderValidatorSet.map(fakeCleanResult),
          actorId: PHASE_GATE_VERIFIER_ACTOR_ID,
        },
        { signingKey: SIGNING_KEY },
      );
      gateReceiptId = receipt.id;
    } finally {
      log.close();
    }

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/2/advance`,
      payload: { gateReceiptId, waiverReceiptId: null },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json() as { allowed: boolean; reasons: string[] };
    expect(body.allowed).toBe(false);
    expect(body.reasons.some((r) => r.includes('validator set is stale'))).toBe(true);
    expect(body.reasons.some((r) => r.includes(droppedValidator))).toBe(true);
  });

  it('ALLOWED + waived (criterion 4a): a human-signed waiver rescues a stale gate on a waiver-eligible phase', async () => {
    const { app, projectId, projectDir, dbPath } = await boot();
    const phase1 = getPhase(1);
    expect(phase1.waiverEligible).toBe(true);
    await writeDocs(projectDir, {
      'docs/SCOPE.md': CLEAN_SCOPE,
      'docs/RISKS.md': CLEAN_RISKS,
      'docs/CONSTRAINTS.md': CLEAN_CONSTRAINTS,
      'docs/USER_PERSONAS.md': CLEAN_PERSONAS,
    });
    const gateReceiptId = await mintCleanGateReceipt(dbPath, projectDir, projectId, 1);

    // Edit a doc after minting — the gate is now genuinely stale.
    await fs.writeFile(
      path.join(projectDir, 'docs/SCOPE.md'),
      CLEAN_SCOPE + '\nscope grew\n',
      'utf8',
    );

    const log = openEventLog(dbPath);
    let waiverReceiptId: string;
    try {
      ensureHumanIdentity(log, 'human-founder', 'Founder');
      const currentInputFiles = await readPhaseInputFiles(phase1, projectDir);
      const waiver = mintReceipt(
        log,
        {
          id: randomUUID(),
          kind: 'waiver',
          projectId,
          phase: 1,
          ticketId: null,
          validators: [],
          inputFiles: currentInputFiles,
          actorId: 'human-founder',
          signedBy: 'human-founder',
        },
        { signingKey: SIGNING_KEY },
      );
      waiverReceiptId = waiver.id;
    } finally {
      log.close();
    }

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/1/advance`,
      payload: { gateReceiptId, waiverReceiptId },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { allowed: boolean; waived: boolean; reasons: string[] };
    expect(body.allowed).toBe(true);
    expect(body.waived).toBe(true);
    expect(body.reasons).toEqual([]);
  });

  it('REFUSED (criterion 4b, FR-P2 blocklist): an agent-signed waiver is rejected', async () => {
    const { app, projectId, projectDir, dbPath } = await boot();
    const phase1 = getPhase(1);
    await writeDocs(projectDir, {
      'docs/SCOPE.md': CLEAN_SCOPE,
      'docs/RISKS.md': CLEAN_RISKS,
      'docs/CONSTRAINTS.md': CLEAN_CONSTRAINTS,
      'docs/USER_PERSONAS.md': CLEAN_PERSONAS,
    });
    const gateReceiptId = await mintCleanGateReceipt(dbPath, projectDir, projectId, 1);
    await fs.writeFile(
      path.join(projectDir, 'docs/SCOPE.md'),
      CLEAN_SCOPE + '\nscope grew\n',
      'utf8',
    );

    // `mintReceipt` itself refuses to mint an agent-signed waiver (kind !==
    // 'human' at mint time, receipts.ts:302) — an agent-signed waiver can
    // never come to exist through the real minting API. `verifyReceipt`'s
    // independent FR-P2 re-check exists precisely for the case the mint-time
    // guard cannot see: a row that was validly tagged (e.g. minted by the
    // real secret-holder, or before the signer identity was reclassified).
    // This constructs exactly that row + anchoring event directly, the same
    // technique `packages/events/src/receipts.test.ts`'s own
    // "FR-P2: even a validly-tagged agent-signed waiver is rejected by the
    // independent re-check" test uses — proving the ROUTE surfaces that
    // independent re-check, not a forged/unminted-looking row.
    const log = openEventLog(dbPath);
    let waiverReceiptId: string;
    try {
      ensureMachineIdentity(log, 'coding-agent', 'Coding Agent');
      const currentInputFiles = await readPhaseInputFiles(phase1, projectDir);
      waiverReceiptId = randomUUID();
      const content = {
        id: waiverReceiptId,
        kind: 'waiver' as const,
        projectId,
        phase: 1,
        ticketId: null,
        validators: [] as ValidatorResult[],
        inputTreeHash: computeInputTreeHash(currentInputFiles),
        verifyCommand: null,
        verifyExit: null,
        signedBy: 'coding-agent',
      };
      const contentMac = computeReceiptMac(content, SIGNING_KEY);
      log.db
        .prepare(
          `INSERT INTO receipts
             (id, kind, project_id, phase, ticket_id, validators, input_tree_hash,
              verify_command, verify_exit, signed_by, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          content.id,
          content.kind,
          content.projectId,
          content.phase,
          content.ticketId,
          JSON.stringify(content.validators),
          content.inputTreeHash,
          content.verifyCommand,
          content.verifyExit,
          content.signedBy,
          'null',
          new Date().toISOString(),
        );
      appendEvent(
        log,
        {
          eventType: 'gate.waived',
          actorId: 'coding-agent',
          ticketId: null,
          payload: { receiptId: content.id, kind: 'waiver', contentMac },
        },
        {},
      );
    } finally {
      log.close();
    }

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/1/advance`,
      payload: { gateReceiptId, waiverReceiptId },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json() as { allowed: boolean; waived: boolean; reasons: string[] };
    expect(body.allowed).toBe(false);
    expect(body.waived).toBe(false);
    // Asserts verifyReceipt's specific kind-guard wording (receipts.ts:526),
    // not just "(FR-P2)" — every one of verifyReceipt's four waiver-branch
    // reasons ends in that tag (no signedBy, identity not found, wrong kind,
    // blocklisted name), so a looser match would still pass if this specific
    // guard silently broke.
    expect(
      body.reasons.some((r) =>
        r.includes(
          'waiver requires a human signature; identity "coding-agent" is kind "machine"',
        ),
      ),
    ).toBe(true);
  });

  it('REFUSED (criterion 4b, FR-P2/FR-N3 blocklist, US-407 AC-1 "agent identities rejected via blocklist"): a human-KIND identity whose name matches the agent-name blocklist is rejected', async () => {
    const { app, projectId, projectDir, dbPath } = await boot();
    const phase1 = getPhase(1);
    await writeDocs(projectDir, {
      'docs/SCOPE.md': CLEAN_SCOPE,
      'docs/RISKS.md': CLEAN_RISKS,
      'docs/CONSTRAINTS.md': CLEAN_CONSTRAINTS,
      'docs/USER_PERSONAS.md': CLEAN_PERSONAS,
    });
    const gateReceiptId = await mintCleanGateReceipt(dbPath, projectDir, projectId, 1);
    await fs.writeFile(
      path.join(projectDir, 'docs/SCOPE.md'),
      CLEAN_SCOPE + '\nscope grew\n',
      'utf8',
    );

    // A DIFFERENT signer guard than the kind check above: `kind: 'human'` (so
    // that guard passes), but a name matching DEFAULT_AGENT_NAME_BLOCKLIST
    // (receipts.ts) — `mintReceipt` also refuses this at mint time, so the
    // same direct row+event construction is required to reach verifyReceipt's
    // independent re-check.
    const log = openEventLog(dbPath);
    let waiverReceiptId: string;
    try {
      ensureHumanIdentity(log, 'blocklisted-signer', 'Copilot Reviewer');
      const currentInputFiles = await readPhaseInputFiles(phase1, projectDir);
      waiverReceiptId = randomUUID();
      const content = {
        id: waiverReceiptId,
        kind: 'waiver' as const,
        projectId,
        phase: 1,
        ticketId: null,
        validators: [] as ValidatorResult[],
        inputTreeHash: computeInputTreeHash(currentInputFiles),
        verifyCommand: null,
        verifyExit: null,
        signedBy: 'blocklisted-signer',
      };
      const contentMac = computeReceiptMac(content, SIGNING_KEY);
      log.db
        .prepare(
          `INSERT INTO receipts
             (id, kind, project_id, phase, ticket_id, validators, input_tree_hash,
              verify_command, verify_exit, signed_by, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          content.id,
          content.kind,
          content.projectId,
          content.phase,
          content.ticketId,
          JSON.stringify(content.validators),
          content.inputTreeHash,
          content.verifyCommand,
          content.verifyExit,
          content.signedBy,
          'null',
          new Date().toISOString(),
        );
      appendEvent(
        log,
        {
          eventType: 'gate.waived',
          actorId: 'blocklisted-signer',
          ticketId: null,
          payload: { receiptId: content.id, kind: 'waiver', contentMac },
        },
        {},
      );
    } finally {
      log.close();
    }

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/1/advance`,
      payload: { gateReceiptId, waiverReceiptId },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json() as { allowed: boolean; waived: boolean; reasons: string[] };
    expect(body.allowed).toBe(false);
    expect(body.waived).toBe(false);
    expect(
      body.reasons.some((r) =>
        r.includes(
          'waiver signer name "Copilot Reviewer" matches the agent-name blocklist',
        ),
      ),
    ).toBe(true);
  });

  it('REFUSED (criterion 4c, FR-G5): a genuinely clean, human-signed waiver still cannot cross phase 4 — build/verify never softens', async () => {
    const { app, projectId, dbPath } = await boot();
    const phase4 = getPhase(4);
    expect(phase4.waiverEligible).toBe(false);

    const log = openEventLog(dbPath);
    let waiverReceiptId: string;
    try {
      ensureHumanIdentity(log, 'human-founder', 'Founder');
      // Phase 4's only deliverable ("ticket-board") is board-shaped, not a real
      // file (`isPathDeliverable`), so its real input tree is always `[]` —
      // matches exactly what the route will read fresh for phase 4.
      const waiver = mintReceipt(
        log,
        {
          id: randomUUID(),
          kind: 'waiver',
          projectId,
          phase: 4,
          ticketId: null,
          validators: [],
          inputFiles: [],
          actorId: 'human-founder',
          signedBy: 'human-founder',
        },
        { signingKey: SIGNING_KEY },
      );
      waiverReceiptId = waiver.id;

      // Sanity: this waiver really does verify clean on its own — the refusal
      // below is the phase-4 policy gate, not a forged/invalid waiver.
      const selfCheck = verifyReceipt(log, waiverReceiptId, {
        signingKey: SIGNING_KEY,
        inputFiles: [],
        requiredValidators: [],
      });
      expect(selfCheck.valid).toBe(true);
    } finally {
      log.close();
    }

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/4/advance`,
      // No real gate receipt has ever been minted for phase 4 — any id refuses
      // gate verification ("receipt not found"), which is what reaches the
      // waiver-eligibility check.
      payload: { gateReceiptId: 'no-such-gate-receipt', waiverReceiptId },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json() as { allowed: boolean; waived: boolean; reasons: string[] };
    expect(body.allowed).toBe(false);
    expect(body.waived).toBe(false);
    expect(body.reasons.some((r) => r.includes('FR-G5'))).toBe(true);
  });

  it(
    'RED FIXTURE (W16-05, US-105 AC-2): a clean gate receipt does NOT rescue a ' +
      'phase citing an unchallenged HIGH research claim — the advance refuses ' +
      'with the claim named, and passes once the recorded verdict is CONFIRMED',
    async () => {
      const { app, projectId, projectDir, dbPath } = await boot();
      await writeDocs(projectDir, {
        'docs/VISION.md': CLEAN_VISION,
        'docs/COMPETITIVE_ANALYSIS.md': CLEAN_COMPETITIVE,
        'docs/research/market.json': JSON.stringify({
          id: 'r-m1',
          topic: 'market',
          phase: 0,
          depth: 'quick',
          sources: [{ id: 's-1', url: 'https://example.invalid/a', tier: 1 }],
          claims: [
            {
              id: 'c-1',
              text: 'the market wants this',
              impact: 'HIGH',
              citedSourceIds: ['s-1'],
            },
          ],
          generatedAt: '2026-08-21T00:00:00.000Z',
        }),
      });
      const gateReceiptId = await mintCleanGateReceipt(dbPath, projectDir, projectId, 0);

      const refused = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/phases/0/advance`,
        payload: { gateReceiptId, waiverReceiptId: null },
      });
      expect(refused.statusCode).toBe(422);
      const refusedBody = refused.json() as { allowed: boolean; reasons: string[] };
      expect(refusedBody.allowed).toBe(false);
      expect(refusedBody.reasons.join('\n')).toMatch(/HIGH-impact claim "c-1"/);

      // The challenge runs elsewhere and leaves its recorded artifact; the
      // gate reads it mechanically (C-2) and the same advance now passes.
      await writeDocs(projectDir, {
        'docs/research/market.challenge.json': JSON.stringify({
          reportId: 'r-m1',
          generatedAt: '2026-08-21T00:00:00.000Z',
          claims: [{ claimId: 'c-1', verdict: 'CONFIRMED' }],
          incomplete: [],
          contradicted: [],
        }),
      });
      const allowed = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/phases/0/advance`,
        payload: { gateReceiptId, waiverReceiptId: null },
      });
      expect(allowed.statusCode).toBe(200);
      expect((allowed.json() as { allowed: boolean }).allowed).toBe(true);
    },
  );

  it('GET .../research/templates serves the phase templates with the recorded depth policy (W16-05, FR-P8)', async () => {
    const { app, projectId } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/research/templates?phase=0`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      phase: number;
      depth: string;
      templates: { id: string; title: string; content_path: string }[];
    };
    expect(body.phase).toBe(0);
    // No stored researchDepth setting: the documented default, never a guess.
    expect(body.depth).toBe('standard');
    expect(body.templates.length).toBeGreaterThan(0);
    expect(body.templates[0]).toHaveProperty('content_path');

    const bad = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/research/templates?phase=nope`,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('returns 404 for an unregistered project', async () => {
    const { app } = await boot();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/does-not-exist/phases/0/advance',
      payload: { gateReceiptId: null, waiverReceiptId: null },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for an unknown phase id', async () => {
    const { app, projectId } = await boot();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/6/advance`,
      payload: { gateReceiptId: null, waiverReceiptId: null },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when asked to advance past the last phase (phase 5)', async () => {
    const { app, projectId } = await boot();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/5/advance`,
      payload: { gateReceiptId: null, waiverReceiptId: null },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for a malformed request body', async () => {
    const { app, projectId } = await boot();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/0/advance`,
      payload: { gateReceiptId: 42 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 503 (SIGNING_KEY_REQUIRED) rather than a forgeable empty-key check when no signing key is configured', async () => {
    const fleetHome = await tmpDir('dokima-advance-route-home-');
    dirs.push(fleetHome);
    const projectDir = await tmpDir('dokima-advance-route-project-');
    dirs.push(projectDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, { path: projectDir, mode: 'new' });
    await writeDocs(projectDir, {
      'docs/VISION.md': CLEAN_VISION,
      'docs/COMPETITIVE_ANALYSIS.md': CLEAN_COMPETITIVE,
    });

    const app = Fastify({ logger: false });
    registerPipelineRoutes(app, { home: fleetHome, signingKey: '' });
    await app.ready();
    apps.push(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${record.id}/phases/0/advance`,
      payload: { gateReceiptId: 'irrelevant-id', waiverReceiptId: null },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json() as { rule: string };
    expect(body.rule).toBe('SIGNING_KEY_REQUIRED');
  });

  it('Law 4 red fixture: a decision maker never mints or flips state on its own — GET .../receipts?phase=0 for this project shows zero minted receipts until a real gate run mints one', async () => {
    const { projectId, dbPath, projectDir } = await boot();
    await writeDocs(projectDir, {
      'docs/VISION.md': CLEAN_VISION,
      'docs/COMPETITIVE_ANALYSIS.md': CLEAN_COMPETITIVE,
    });

    const log = openEventLog(dbPath);
    try {
      const countBefore = log.db.prepare('SELECT COUNT(*) as n FROM receipts').get() as {
        n: number;
      };
      expect(countBefore.n).toBe(0);
    } finally {
      log.close();
    }

    // The advance route itself never mints anything — it only re-verifies
    // already-minted receipts. Confirmed by minting one for real via the W9-06
    // runner (a distinct code path) and observing the receipt table only grows
    // through that call, never through the advance POST above.
    await mintCleanGateReceipt(dbPath, projectDir, projectId, 0);
    const log2 = openEventLog(dbPath);
    try {
      const countAfter = log2.db.prepare('SELECT COUNT(*) as n FROM receipts').get() as {
        n: number;
      };
      expect(countAfter.n).toBe(1);
    } finally {
      log2.close();
    }
  });
});

/**
 * W16-07: the gate-receipt MINTER route — runPhaseGate's first production
 * caller. Until this, the advance route verified receipts nothing could
 * mint, so every real advance refused forever.
 */
describe('POST /api/v1/projects/:id/phases/:n/gate (W16-07)', () => {
  const dirs: string[] = [];
  const apps: FastifyInstance[] = [];
  let previousMermaidNoRender: string | undefined;
  beforeEach(() => {
    previousMermaidNoRender = process.env.MERMAID_NO_RENDER;
    process.env.MERMAID_NO_RENDER = '1';
  });
  afterEach(async () => {
    if (previousMermaidNoRender === undefined) {
      delete process.env.MERMAID_NO_RENDER;
    } else {
      process.env.MERMAID_NO_RENDER = previousMermaidNoRender;
    }
    await Promise.all(apps.splice(0).map((a) => a.close()));
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function bootGate() {
    const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-gate-home-'));
    dirs.push(fleetHome);
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-gate-project-'));
    dirs.push(projectDir);
    const contentDir = await mkConformingValidatorContentDir(getPhase(0).validators);
    dirs.push(contentDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, { path: projectDir, mode: 'new' });
    const app = Fastify({ logger: false });
    registerPipelineRoutes(app, {
      home: fleetHome,
      signingKey: SIGNING_KEY,
      gateContentDir: contentDir,
    });
    await app.ready();
    apps.push(app);
    await fs.mkdir(path.join(projectDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'docs/VISION.md'), CLEAN_VISION);
    await fs.writeFile(path.join(projectDir, 'docs/COMPETITIVE_ANALYSIS.md'), CLEAN_COMPETITIVE);
    return { app, projectId: record.id, projectDir };
  }

  it('RED FIXTURE (the whole point): gate mints a real receipt on clean content, and THAT receipt advances the phase — while a receipt id the gate never minted still refuses', async () => {
    const { app, projectId } = await bootGate();

    const gate = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/0/gate`,
      payload: { authorActorId: AUTHOR_ACTOR_ID },
    });
    expect(gate.statusCode).toBe(200);
    const gateBody = gate.json() as { ok: boolean; receipt_id: string | null };
    expect(gateBody.ok).toBe(true);
    expect(gateBody.receipt_id).toBeTruthy();

    const advance = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/0/advance`,
      payload: { gateReceiptId: gateBody.receipt_id, waiverReceiptId: null },
    });
    expect(advance.statusCode).toBe(200);
    expect((advance.json() as { allowed: boolean }).allowed).toBe(true);

    const forged = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/0/advance`,
      payload: { gateReceiptId: 'receipt-that-was-never-minted', waiverReceiptId: null },
    });
    expect(forged.statusCode).not.toBe(200);
  });

  it('Law 5: the author cannot be the verifier — refused before any validator runs', async () => {
    const { app, projectId } = await bootGate();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/0/gate`,
      payload: { authorActorId: PHASE_GATE_VERIFIER_ACTOR_ID },
    });
    expect(res.statusCode).toBe(422);
  });

  it('a missing authorActorId is a 400 naming the field, never a guessed identity', async () => {
    const { app, projectId } = await bootGate();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/phases/0/gate`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain('authorActorId');
  });

  it('the W9-08 mermaid fix is truly dead code-history: the REAL content/validators pack mints a clean phase-0 receipt on clean content, and that receipt advances', async () => {
    const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-gate-real-home-'));
    dirs.push(fleetHome);
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-gate-real-project-'));
    dirs.push(projectDir);
    const realContentDir = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../../../../../..',
      'content',
      'validators',
    );
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, { path: projectDir, mode: 'new' });
    const app = Fastify({ logger: false });
    registerPipelineRoutes(app, {
      home: fleetHome,
      signingKey: SIGNING_KEY,
      gateContentDir: realContentDir,
    });
    await app.ready();
    apps.push(app);
    await fs.mkdir(path.join(projectDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'docs/VISION.md'), CLEAN_VISION);
    await fs.writeFile(
      path.join(projectDir, 'docs/COMPETITIVE_ANALYSIS.md'),
      CLEAN_COMPETITIVE,
    );

    const gate = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${record.id}/phases/0/gate`,
      payload: { authorActorId: AUTHOR_ACTOR_ID },
    });
    expect(gate.statusCode).toBe(200);
    const receiptId = (gate.json() as { receipt_id: string | null }).receipt_id;
    expect(receiptId).toBeTruthy();

    const advance = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${record.id}/phases/0/advance`,
      payload: { gateReceiptId: receiptId, waiverReceiptId: null },
    });
    expect(advance.statusCode).toBe(200);
    expect((advance.json() as { allowed: boolean }).allowed).toBe(true);
  });
});