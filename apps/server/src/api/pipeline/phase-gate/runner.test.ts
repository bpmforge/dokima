import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getIdentity,
  openEventLog,
  verifyReceipt,
  type EventLog,
} from '@dokima/events';
import {
  loadValidatorPack,
  mintValidatorRunReceipt,
  runValidatorPack,
} from '@dokima/validators';
import { PHASES } from '@dokima/pipeline';
import {
  ensurePhaseGateVerifierIdentity,
  PHASE_GATE_VERIFIER_ACTOR_ID,
  PhaseGateSameIdentityError,
} from './identity.js';
import { runPhaseGate } from './runner.js';

const SIGNING_KEY = 'test-signing-key-w9-06';

function realContentDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return path.resolve(here, '../../../../../../content/validators');
}

async function mkTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-phase-gate-'));
  await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
  return dir;
}

/**
 * A `validate-mermaid`-named fixture validator conforming to the shared `_lib.sh`
 * envelope (`{"validator":...,"gaps":N,"exit":N,"items":[...]}`) real validators emit
 * — same technique `packages/harbormaster/src/loop-gates.test.ts` uses for its own
 * synthetic-script cases. Needed because the REPO'S REAL `content/validators/
 * validate-mermaid.sh` does not source `_lib.sh` and emits NOTHING to stdout on a
 * genuinely clean scan (confirmed empirically: `MERMAID_NO_RENDER=1 bash
 * content/validators/validate-mermaid.sh <clean-dir>` exits 0 with zero-byte stdout) —
 * `parseValidatorOutput('')` returns `null` (malformed-output, contract.ts), so
 * `runValidator` normalizes that specific script's clean case to exitCode 2, never 0.
 * That is a pre-existing gap in `content/validators/validate-mermaid.sh` itself (data,
 * "DO NOT EDIT", and out of this ticket's write_scope either way) — not a bug in this
 * runner, which correctly refuses to mint on the resulting exitCode 2 (see the
 * `evaluate.test.ts` exitCode-2 case). This fixture isolates the runner's own clean-
 * mint logic from that unrelated, already-known-avoided validator quirk (close-gate's
 * own `DEFAULT_REQUIRED_VALIDATORS` list deliberately excludes `validate-mermaid` for
 * the same reason). The supplementary test below proves REAL, unmodified
 * `content/validators` content still works end-to-end for a validator that does
 * conform (`secrets-scan`).
 */
async function mkConformingMermaidContentDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-fixture-validators-'));
  const script =
    '#!/bin/bash\n' +
    'echo \'{"validator":"validate-mermaid","gaps":0,"exit":0,"items":[]}\'\n';
  const scriptPath = path.join(dir, 'validate-mermaid.sh');
  await fs.writeFile(scriptPath, script, { mode: 0o755 });
  return dir;
}

const CLEAN_VISION = '# Vision\n\nA plain document with no Mermaid diagrams at all.\n';
const CLEAN_COMPETITIVE = '# Competitive Analysis\n\nAlso plain.\n';

/**
 * M013: a backtick anywhere inside a mermaid diagram body is a confirmed-bug ERROR
 * (validate-mermaid.sh's own header), guaranteeing a real, non-zero exit with gaps.
 * TWO distinct M013 lines, deliberately — with exactly one finding, validate-mermaid.sh
 * emits a single-line JSON object (`{"severity":...}`, no `gaps` field); `contract.ts`'s
 * `parseValidatorOutput` runs `JSON.parse` on the whole trimmed stdout FIRST, which
 * *succeeds* for one valid single-line object and returns `null` (no numeric `gaps`
 * field) without ever falling through to the NDJSON per-line parser — so a one-finding
 * run misparses as malformed (exitCode 2) rather than "1 real gap" (exitCode 1).
 * Confirmed empirically both ways. Two-plus findings make the whole trimmed stdout
 * invalid as a single JSON document, so `JSON.parse` throws and the NDJSON fallback
 * (one object per line) correctly takes over. That parser quirk is
 * `packages/validators/src/contract.ts` (out of this ticket's write_scope) — this
 * fixture works around it to exercise the runner's "genuinely failing validator" path
 * with a result that unambiguously means "gaps found", not "malformed".
 */
const BROKEN_VISION = [
  '# Vision',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[`bad label one`] --> B[Ok]',
  '  C[`bad label two`] --> D[Ok]',
  '```',
  '',
].join('\n');

/**
 * W21-11: this suite runs REAL validators inside the SC-07 sandbox. At idle it
 * finishes in under a second, which is why the W21-08 measurement pass did not
 * flag it — but sandbox startup costs seconds once ~20 vitest workers are each
 * booting one, and it then dies on vitest's 5s default while the validators
 * themselves are still starting.
 *
 * Same remedy and same reasoning as W20-13 and W21-07: the timeout fits the
 * work, nothing is stubbed out, and no assertion is loosened.
 */
const GATE_TIMEOUT_MS = 30_000;

describe('runPhaseGate (W9-06)', () => {
  let log: EventLog;
  let projectDir: string;
  let previousMermaidNoRender: string | undefined;

  beforeEach(async () => {
    log = openEventLog(':memory:');
    projectDir = await mkTempProject();
    // Deterministic test env only: skip validate-mermaid.sh's optional real `mmdc`
    // render pass (mmdc happens to be on PATH on this machine) — production code never
    // sets this, the runner just inherits whatever env the server process runs under.
    previousMermaidNoRender = process.env.MERMAID_NO_RENDER;
    process.env.MERMAID_NO_RENDER = '1';
  });

  afterEach(async () => {
    log.close();
    await fs.rm(projectDir, { recursive: true, force: true });
    if (previousMermaidNoRender === undefined) {
      delete process.env.MERMAID_NO_RENDER;
    } else {
      process.env.MERMAID_NO_RENDER = previousMermaidNoRender;
    }
  });

  it('RED->GREEN (criterion 3): refuses to run at all when authorActorId === verifierActorId, mints nothing', async () => {
    await fs.writeFile(path.join(projectDir, 'docs/VISION.md'), CLEAN_VISION);
    await fs.writeFile(
      path.join(projectDir, 'docs/COMPETITIVE_ANALYSIS.md'),
      CLEAN_COMPETITIVE,
    );

    await expect(
      runPhaseGate(
        log,
        {
          projectId: 'proj-1',
          phaseId: 0,
          contentDir: realContentDir(),
          projectRoot: projectDir,
          authorActorId: 'phase-gate-runner', // same as the default verifier identity
        },
        { signingKey: SIGNING_KEY },
      ),
    ).rejects.toThrow(PhaseGateSameIdentityError);

    const receiptCount = log.db.prepare('SELECT COUNT(*) as n FROM receipts').get() as {
      n: number;
    };
    expect(receiptCount.n).toBe(0);
  });

  it('RED->GREEN (criterion 4a): a genuinely failing validator (real content/validators/validate-mermaid.sh, real M013 defect) mints NO receipt', async () => {
    await fs.writeFile(path.join(projectDir, 'docs/VISION.md'), BROKEN_VISION);
    await fs.writeFile(
      path.join(projectDir, 'docs/COMPETITIVE_ANALYSIS.md'),
      CLEAN_COMPETITIVE,
    );

    const result = await runPhaseGate(
      log,
      {
        projectId: 'proj-1',
        phaseId: 0,
        contentDir: realContentDir(),
        projectRoot: projectDir,
        authorActorId: 'specialist:pm-interviewer',
      },
      { signingKey: SIGNING_KEY },
    );

    expect(result.ok).toBe(false);
    expect(result.receipt).toBeNull();
    expect(result.results).toHaveLength(1);
    // Confirmed empirically (manual run against this exact fixture): the real script
    // exits 1 with two M013 JSON gaps — a normal "gaps found" run, not a malformed one
    // (see BROKEN_VISION's comment on why exactly one finding would misparse instead).
    expect(result.results[0]?.exitCode).toBe(1);
    expect(result.results[0]?.gapCount).toBe(2);

    const receiptCount = log.db.prepare('SELECT COUNT(*) as n FROM receipts').get() as {
      n: number;
    };
    expect(receiptCount.n).toBe(0);
  });

  it('RED->GREEN (criterion 4b): a validator pack that fails to load (no validator run at all) mints NO receipt', async () => {
    await fs.writeFile(path.join(projectDir, 'docs/VISION.md'), CLEAN_VISION);
    await fs.writeFile(
      path.join(projectDir, 'docs/COMPETITIVE_ANALYSIS.md'),
      CLEAN_COMPETITIVE,
    );
    const emptyContentDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'sw-empty-validators-'),
    );

    try {
      const result = await runPhaseGate(
        log,
        {
          projectId: 'proj-1',
          phaseId: 0,
          contentDir: emptyContentDir,
          projectRoot: projectDir,
          authorActorId: 'specialist:pm-interviewer',
        },
        { signingKey: SIGNING_KEY },
      );

      expect(result.ok).toBe(false);
      expect(result.receipt).toBeNull();
      expect(result.results).toEqual([]);
      const receiptCount = log.db.prepare('SELECT COUNT(*) as n FROM receipts').get() as {
        n: number;
      };
      expect(receiptCount.n).toBe(0);
    } finally {
      await fs.rm(emptyContentDir, { recursive: true, force: true });
    }
  });

  it('GREEN (orchestration logic only — NOT a real-content demonstration, see the module header and the real-content test below for that): runPhaseGate mints via mintValidatorRunReceipt under the distinct verifier identity when every declared validator reports exitCode 0, and the receipt round-trips through verifyReceipt', async () => {
    await fs.writeFile(path.join(projectDir, 'docs/VISION.md'), CLEAN_VISION);
    await fs.writeFile(
      path.join(projectDir, 'docs/COMPETITIVE_ANALYSIS.md'),
      CLEAN_COMPETITIVE,
    );
    const fixtureContentDir = await mkConformingMermaidContentDir();

    try {
      const result = await runPhaseGate(
        log,
        {
          projectId: 'proj-1',
          phaseId: 0,
          contentDir: fixtureContentDir,
          projectRoot: projectDir,
          authorActorId: 'specialist:pm-interviewer',
          id: randomUUID(),
        },
        { signingKey: SIGNING_KEY },
      );

      expect(result.ok).toBe(true);
      expect(result.receipt).not.toBeNull();
      expect(result.receipt?.kind).toBe('gate');
      expect(result.receipt?.phase).toBe(0);
      expect(result.results.every((r) => r.exitCode === 0)).toBe(true);

      // The verifier identity is real and distinct from the author.
      const verifier = getIdentity(log, 'phase-gate-runner');
      expect(verifier?.kind).toBe('machine');

      const currentInputFiles = [
        { path: 'docs/VISION.md', content: CLEAN_VISION },
        { path: 'docs/COMPETITIVE_ANALYSIS.md', content: CLEAN_COMPETITIVE },
      ];

      // The real consumer-shaped check (decideAdvance's own re-verification path).
      const verified = verifyReceipt(log, result.receipt!.id, {
        signingKey: SIGNING_KEY,
        inputFiles: currentInputFiles,
        requiredValidators: PHASES[0]!.validators,
      });
      expect(verified.valid).toBe(true);
      expect(verified.reasons).toEqual([]);

      // FR-P2: a silently edited doc invalidates the receipt (input-tree hash mismatch).
      const editedInputFiles = [
        { path: 'docs/VISION.md', content: CLEAN_VISION + '\nedited after the fact\n' },
        { path: 'docs/COMPETITIVE_ANALYSIS.md', content: CLEAN_COMPETITIVE },
      ];
      const staleCheck = verifyReceipt(log, result.receipt!.id, {
        signingKey: SIGNING_KEY,
        inputFiles: editedInputFiles,
        requiredValidators: PHASES[0]!.validators,
      });
      expect(staleCheck.valid).toBe(false);
      expect(staleCheck.reasons.some((r) => r.includes('input tree hash mismatch'))).toBe(
        true,
      );
    } finally {
      await fs.rm(fixtureContentDir, { recursive: true, force: true });
    }
  });

  it('GREEN (real content, criterion 2 proof): REAL, unmodified content/validators/secrets-scan.sh runs clean, and its result mints a receipt via the real mintValidatorRunReceipt/verifyReceipt pair — zero synthetic validator content anywhere in this test', async () => {
    // `runPhaseGate` itself cannot be used for this proof: `getPhase(0)` always
    // includes `validate-mermaid` (R-H3, unconditional across all six phases), and that
    // real script cannot produce contract-conforming stdout on a clean scan (see this
    // file's header and runner.ts's module doc) — so no phase can reach a clean mint
    // through `runPhaseGate` against 100% real, unmodified content today. This test
    // instead drives the exact same primitives `runPhaseGate` composes —
    // `loadValidatorPack` -> `runValidatorPack` -> `mintValidatorRunReceipt` ->
    // `verifyReceipt` — directly, with `secrets-scan.sh` (a real script that DOES
    // source `_lib.sh` and conform to the contract), to prove the mint/verify machinery
    // itself is correct end to end against real content, independent of the
    // validate-mermaid.sh gap.
    const specs = await loadValidatorPack({
      contentDir: realContentDir(),
      select: ['secrets-scan'],
    });
    const results = await runValidatorPack(specs, {
      cwd: projectDir, // no secrets anywhere in the clean temp project
      timeoutMs: 30_000,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('secrets-scan');
    expect(results[0]?.exitCode).toBe(0);

    ensurePhaseGateVerifierIdentity(log);

    const receipt = mintValidatorRunReceipt(
      log,
      {
        id: randomUUID(),
        kind: 'gate',
        projectId: 'proj-1',
        phase: null,
        ticketId: null,
        inputFiles: [],
        results,
        actorId: PHASE_GATE_VERIFIER_ACTOR_ID,
      },
      { signingKey: SIGNING_KEY },
    );

    expect(receipt.kind).toBe('gate');
    expect(receipt.validators).toEqual([
      { name: 'secrets-scan', exitCode: 0, gapCount: 0 },
    ]);

    const verified = verifyReceipt(log, receipt.id, {
      signingKey: SIGNING_KEY,
      inputFiles: [],
      requiredValidators: ['secrets-scan'],
    });
    expect(verified).toEqual({ valid: true, reasons: [] });
  });
}, GATE_TIMEOUT_MS);
