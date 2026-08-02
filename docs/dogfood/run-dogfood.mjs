#!/usr/bin/env node
/**
 * W8-01 dogfood driver: runs the REAL onboard + security-cluster +
 * threat-model-refresh pipeline against this repo -- the same real building
 * blocks `runOnboardAnalysis` (`apps/server/src/api/pipeline/onboard-run.ts`)
 * composes for the CLI (`run start --mode onboard`) and the HTTP route,
 * called directly here rather than through that one convenience wrapper
 * (see DEDUP note below for why). Model access goes through the real
 * `@dokima/gateway` OpenAI-compat provider, pointed at a local
 * OpenAI-compatible server (LM Studio on localhost) -- local-first (Law 9),
 * no network, no fake gateway.
 *
 * Lives under docs/dogfood/ (this ticket's write_scope) rather than
 * scripts/ or apps/server/src/cli/ -- adding a CLI flag to dump the full
 * OnboardRunResult to disk would touch apps/server/src/cli/run-cmd.ts,
 * which is outside W8-01's write_scope (see MASTER_PROMPT.md: widen scope
 * only via a HANDOFF note, never silently). Composing the already-exported
 * real functions and writing their return values out here needs no such
 * widening.
 *
 * RETRY (temperature jitter, not a second implementation): retries a step's
 * dispatch call on `MalformedModelOutputError` before giving up. `spawn`
 * inside `createRealOnboardDispatch` hardcodes `temperature: 0`, so a
 * byte-identical failing completion (observed live: an unescaped backslash
 * in a regex a specialist quoted verbatim from a real validator script)
 * repeats forever on a bare retry. `OnboardGatewayConfig.fetchImpl` is a
 * real seam the shipped code already exposes (built for tests, but
 * structurally just "the fetch used for HTTP"); this script's `fetchImpl`
 * bumps the outgoing request's `temperature` field only on retry attempts,
 * breaking that determinism without touching the prompt, the parsing, or
 * the trust boundary -- same real model, same real HANDOFF, same real
 * content, just less greedy decoding on a retry. If a step still fails
 * after MAX_ATTEMPTS the whole run throws with no output written,
 * preserving `runOnboardExecution`'s all-or-nothing guarantee (W8-08 AC3).
 *
 * DEDUP (a real gap this dogfood run surfaced, documented rather than
 * silently patched): `proposePlanItemsFromOnboardFindings` dedupes a new
 * finding against ALREADY-PERSISTED plan_items, but not against other new
 * findings in the SAME batch -- two steps (or one step listing a title
 * twice) reporting the exact same `[role] title` collide on
 * `catalogIdFor`'s content hash and crash the insert transaction
 * (`UNIQUE constraint failed: plan_items.id`, reproduced live against this
 * repo's own real specialist output on 2026-07-21, see
 * docs/dogfood/DOGFOOD_REPORT.md "Findings surfaced by the dogfood run
 * itself"). Fixing that in `onboard-board-lifecycle.ts` is outside this
 * ticket's write_scope, so this driver calls the lower-level, already
 * -exported pieces (`flattenOnboardFindings` /
 * `proposePlanItemsFromOnboardFindings` / `acceptOnboardPlanItems`) instead
 * of the all-in-one `runOnboardAnalysis`, and dedupes by `catalogIdFor`
 * itself before proposing -- the same real functions, same real board
 * lifecycle, just with an in-batch duplicate collapsed to one row first
 * (identical content, so no information lost). The underlying gap is
 * reported as a finding, not worked around silently.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function importRepoModule(relFromRoot) {
  return import(pathToFileURL(path.resolve(repoRoot, relFromRoot)).href);
}

const { resolveDbPath, openWritableLog } = await importRepoModule(
  'apps/server/src/cli/db.ts',
);
const { ensureActorIdentity } = await importRepoModule(
  'apps/server/src/cli/identity.ts',
);
const { createRun } = await importRepoModule('packages/harbormaster/src/index.ts');
const { appendEvent } = await importRepoModule('packages/events/src/index.ts');
const { ensureOperatorIdentity, OPERATOR_ACTOR_ID } = await importRepoModule(
  'apps/server/src/api/server/board-actor.ts',
);
const { gatherOnboardRepoContext } = await importRepoModule(
  'apps/server/src/api/pipeline/onboard-repo-context.ts',
);
const { runOnboardExecution } = await importRepoModule(
  'apps/server/src/api/pipeline/onboard-executor.ts',
);
const {
  flattenOnboardFindings,
  proposePlanItemsFromOnboardFindings,
  acceptOnboardPlanItems,
  catalogIdFor,
} = await importRepoModule('apps/server/src/api/pipeline/onboard-board-lifecycle.ts');
const { createRealOnboardDispatch, resolveOnboardGatewayConfigFromEnv } =
  await importRepoModule('apps/server/src/api/pipeline/onboard-dispatch-port.ts');
const { MalformedModelOutputError } = await importRepoModule(
  'apps/server/src/api/pipeline/errors.ts',
);

const ACTOR_ID = process.env.DOGFOOD_ACTOR_ID ?? 'dogfood-agent';
const PROJECT_ID = process.env.DOGFOOD_PROJECT_ID ?? 'dokima-self';
const MAX_ATTEMPTS = Number(process.env.DOGFOOD_MAX_ATTEMPTS ?? '4');

// Sequential retries only (never concurrent dispatch calls -- runRealPreflight
// itself is sequential, module header), so a shared mutable attempt counter
// read by `jitteredFetch` below is safe: at most one dispatch call is ever
// in flight against it at a time.
let currentAttempt = 1;

function jitteredFetch(url, init) {
  if (currentAttempt > 1 && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body);
      body.temperature = Math.min(0.2 * currentAttempt, 0.8);
      return fetch(url, { ...init, body: JSON.stringify(body) });
    } catch {
      // Non-JSON body (shouldn't happen for this provider) -- fall through unmodified.
    }
  }
  return fetch(url, init);
}

const gatewayConfig = {
  ...resolveOnboardGatewayConfigFromEnv(),
  model: process.env.DOKIMA_MODEL_ID ?? 'nemotron-cascade-2-30b-a3b',
  fetchImpl: jitteredFetch,
};

const baseDispatch = createRealOnboardDispatch({ config: gatewayConfig, repoRoot });

async function retryingDispatch(role, context) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    currentAttempt = attempt;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential retries by design
      return await baseDispatch(role, context);
    } catch (err) {
      lastErr = err;
      if (!(err instanceof MalformedModelOutputError)) throw err;
      process.stderr.write(
        `[dogfood] ${role} (${context.stepId}) attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}\n`,
      );
    }
  }
  throw lastErr;
}

const now = () => new Date().toISOString();
const dbPath = resolveDbPath(repoRoot);
const log = openWritableLog(dbPath);

const startedAt = now();
let result;
let stepArtifacts;
let proposed;
let accepted;
let duplicatesCollapsed = 0;
let run;
try {
  ensureActorIdentity(log, ACTOR_ID, now);
  run = createRun(
    log,
    {
      id: `run-dogfood-${Date.now()}`,
      projectId: PROJECT_ID,
      mode: 'onboard',
      phase: null,
      breakpoint: 'never',
      berths: 1,
      budgetUsd: null,
      budgetTokens: null,
      actorId: ACTOR_ID,
    },
    { now },
  );
  process.stderr.write(`[dogfood] run ${run.id} started against ${repoRoot}\n`);

  const repoContext = await gatherOnboardRepoContext(repoRoot);
  const input = { seedContext: { ...repoContext } };

  ({ result, stepArtifacts } = await runOnboardExecution(input, {
    log,
    runId: run.id,
    now,
    dispatch: retryingDispatch,
  }));

  ensureOperatorIdentity(log, now);
  appendEvent(
    log,
    {
      eventType: 'onboard.run_completed',
      actorId: OPERATOR_ACTOR_ID,
      runId: run.id,
      payload: { stepIds: Object.keys(result.stepArtifacts), coverageManifest: result.coverageManifest },
    },
    { now },
  );

  const origins = flattenOnboardFindings(stepArtifacts);
  const byCatalogId = new Map();
  for (const origin of origins) {
    const id = catalogIdFor(origin);
    if (byCatalogId.has(id)) {
      duplicatesCollapsed += 1;
    } else {
      byCatalogId.set(id, origin);
    }
  }
  const dedupedOrigins = [...byCatalogId.values()];

  const { created } = await proposePlanItemsFromOnboardFindings(
    repoRoot,
    dedupedOrigins,
    { runId: run.id, now },
  );
  accepted = await acceptOnboardPlanItems(repoRoot, created, dedupedOrigins, { now });
  proposed = created;
} finally {
  log.close();
}
const finishedAt = now();

const outDir = path.resolve(repoRoot, 'docs/dogfood');
await mkdir(outDir, { recursive: true });

await writeFile(
  path.join(outDir, 'run-result.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);
await writeFile(
  path.join(outDir, 'findings-tickets.json'),
  `${JSON.stringify(
    {
      note:
        duplicatesCollapsed > 0
          ? `${duplicatesCollapsed} exact-duplicate finding(s) (same role+title from the same or another step) were collapsed to one row before proposing -- see run-dogfood.mjs's DEDUP header note. Nothing else was filtered.`
          : 'No duplicate findings were collapsed in this run.',
      proposed,
      accepted,
    },
    null,
    2,
  )}\n`,
);

const antiSlopCounts = { proposed: 0, shadow: 0, advisory: 0, gate: 0, deprecated: 0 };
for (const r of result.coverageManifest.antiSlopRules) antiSlopCounts[r.state] += 1;
const validatorCounts = { proposed: 0, shadow: 0, advisory: 0, gate: 0, deprecated: 0 };
for (const v of result.coverageManifest.validators) validatorCounts[v.state] += 1;

const receiptRows = Object.entries(stepArtifacts).map(([stepId, artifact]) => ({
  stepId,
  role: artifact.role,
  summary: artifact.summary,
  findingCount: artifact.findings.length,
  session: artifact.session,
}));
await writeFile(
  path.join(outDir, 'receipts.json'),
  `${JSON.stringify(
    {
      note:
        'Per-step audit evidence (session exitCode + observed write-scope ' +
        'violations from the real runSession/git-diff check), not a minted ' +
        '@dokima/events ReceiptRecord -- onboard findings are a ' +
        "specialist's own self-report with no independent validator run " +
        'against them, so minting a gate/coverage receipt for them would be ' +
        'the self-attestation antipattern Law 4/5 forbids (see ' +
        'apps/server/src/api/pipeline/onboard-executor.ts SELF-ATTEST NOTE). ' +
        'Each row here corresponds to one real onboard.step-complete AUDIT ' +
        'event, hash-chained into .dokima/state.db and signed by that ' +
        "step's specialist:<role> identity (never the operator identity).",
      runId: run.id,
      startedAt,
      finishedAt,
      model: gatewayConfig.model,
      baseUrl: gatewayConfig.baseUrl,
      steps: receiptRows,
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  path.join(outDir, 'coverage-manifest.json'),
  `${JSON.stringify(
    {
      note:
        'D-014 rule lifecycle: shadow runs for real but never blocks; ' +
        'advisory is waiver-eligible; gate is non-waivable. Raw counts ' +
        'below are never hidden (D-014 raw -> deduped -> effective -> ' +
        'suppressed surface requirement) -- there is no suppression here, ' +
        'so raw == effective for this manifest.',
      antiSlopRuleCount: result.coverageManifest.antiSlopRules.length,
      antiSlopRuleCountsByState: antiSlopCounts,
      validatorCount: result.coverageManifest.validators.length,
      validatorCountsByState: validatorCounts,
      antiSlopRules: result.coverageManifest.antiSlopRules,
      validators: result.coverageManifest.validators,
    },
    null,
    2,
  )}\n`,
);

process.stderr.write(
  `[dogfood] run ${run.id} complete: ${Object.keys(stepArtifacts).length} steps, ` +
    `${proposed.length} findings proposed, ${accepted.length} accepted onto the board, ` +
    `${result.coverageManifest.antiSlopRules.length} anti-slop rules + ` +
    `${result.coverageManifest.validators.length} validators enumerated\n`,
);
