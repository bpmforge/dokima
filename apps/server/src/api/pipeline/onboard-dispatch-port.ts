/**
 * Real specialist dispatch for `runOnboard`'s `OnboardDispatch` seam (W8-09
 * AC1): every onboard/security-cluster/threat-model-refresh step's role is
 * run as a real `@shipwright/loop` HANDOFF session — the exact contract
 * `packages/harbormaster/src/loop-claim.ts` uses to run a ticket's coding
 * session — except this session's `spawn` calls the real gateway
 * (`@shipwright/gateway`'s `createOaiCompatProvider`, Law 6: model access
 * only through the gateway, never a direct provider) instead of a child
 * process CLI: an onboard/analysis specialist reads and reports on the repo,
 * it has no code to write, but it still goes through the same
 * role/mission/context/write-scope/produce/verify HANDOFF block, the same
 * thinking-strip, and the same real `git diff` write-scope check every
 * other specialist session does (`runSession`, `packages/loop/src/session.ts`).
 *
 * DYNAMIC IMPORT (not a static `from '@shipwright/loop'`): this ticket's
 * write_scope is `apps/server/src/api/pipeline/**` + `.../cli/run-cmd.ts`
 * only — it does not include `apps/server/package.json`, so there is no
 * glob this ticket may use to add a declared workspace dependency on
 * `@shipwright/loop` (pnpm's strict, non-hoisted linking means an
 * undeclared package is simply not resolvable via a static import here; the
 * SAME wall `packages/pipeline/src/plans/types.ts` and `phases/types.ts`
 * document for THEIR narrower write_scopes). The correct move on hitting
 * this wall is never to self-widen `write_scope` (confirmed the hard way on
 * W8-06: a maker's own edit to its own ticket's declared scope is treated as
 * illegitimate self-authorization regardless of whether the validator
 * tolerates the overlap) — it is the sanctioned workaround this repo
 * already uses elsewhere for exactly this shape of wall (`apps/web/e2e/
 * fixtures/seed-board-tickets.mjs`'s module header): `import()` the other
 * package's real `src/index.ts` by absolute `file://` URL. `tsx` (this
 * app's dev/CLI runtime) and `vitest` (its test runtime) both transform
 * `.ts` on any import, static or dynamic, so this reaches the REAL
 * `runSession` — not a reimplementation of it — at the cost of losing
 * static typing across this one boundary (a dynamic, non-literal import
 * specifier is `any` to `tsc`), so every value crossing it is defensively
 * treated as untrusted/unknown, same discipline as a gateway completion.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createOaiCompatProvider, type Provider } from '@shipwright/gateway';
import { MalformedModelOutputError } from './errors.js';
import { parseOnboardCompletion, type OnboardStepArtifact } from './onboard-types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/server/src/api/pipeline/ -> repo root -> packages/loop/src/index.ts
const LOOP_ENTRY = path.resolve(here, '../../../../../packages/loop/src/index.ts');

interface LoopModule {
  readonly runSession: (input: {
    readonly handoff: {
      readonly role: string;
      readonly mission: string;
      readonly ticket: { readonly id: string; readonly title: string };
      readonly context: string;
      readonly writeScope: readonly string[];
      readonly produce: readonly string[];
      readonly verify: string;
    };
    readonly cwd: string;
    readonly baseRef?: string;
    readonly spawn: (input: {
      readonly prompt: string;
      readonly cwd: string;
    }) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
  }) => Promise<{
    readonly exitCode: number | null;
    readonly output: string;
    readonly scopeViolations: readonly string[];
  }>;
}

let cachedLoopModule: Promise<LoopModule> | undefined;

/** Loads the real `@shipwright/loop` module exactly once per process — see
 * module header for why this is a dynamic `file://` import rather than a
 * static one. Overridable (tests only) via `loadLoopModuleForTests`. */
function loadLoopModule(): Promise<LoopModule> {
  cachedLoopModule ??= import(pathToFileURL(LOOP_ENTRY).href) as Promise<LoopModule>;
  return cachedLoopModule;
}

/** Test-only seam: point the dispatch port at a fake `runSession` instead of
 * the dynamically-imported real one, without needing a real git worktree or
 * a real gateway HTTP round trip for pure port-plumbing tests. */
export function loadLoopModuleForTests(fake: LoopModule): void {
  cachedLoopModule = Promise.resolve(fake);
}

export function resetLoopModuleCacheForTests(): void {
  cachedLoopModule = undefined;
}

export interface OnboardGatewayConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  /** Test-only override — real callers always get the real `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/** Local-first default (C-1): the same LM Studio-shaped localhost endpoint
 * `gateway-model-port.ts` defaults to. */
export function resolveOnboardGatewayConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OnboardGatewayConfig {
  return {
    baseUrl: env.SHIPWRIGHT_MODEL_BASE_URL ?? 'http://127.0.0.1:1234/v1',
    apiKey: env.SHIPWRIGHT_MODEL_API_KEY,
    model: env.SHIPWRIGHT_MODEL_ID ?? 'local-model',
  };
}

const ONBOARD_SPECIALIST_SYSTEM_PROMPT =
  'You are a Shipwright onboard/analysis specialist. You are given a HANDOFF ' +
  'block naming your role and a JSON context (seed context + prior steps’ ' +
  'artifacts). Analyze the repository and respond with ONLY a JSON object of ' +
  'the shape {"summary": string, "findings": [{"title": string, "severity": ' +
  '"LOW"|"MEDIUM"|"HIGH"|"CRITICAL", "recommendation": string, "verify": ' +
  'string}]}. "findings" may be an empty array if you have nothing to report. ' +
  'Never claim a ticket, plan, or receipt state — you have no authority over ' +
  'board state, only over what you observe.';

/** One real specialist dispatch call: role + context in, `OnboardStepArtifact`
 * out. Async by necessity (a real gateway call + a real `runSession` are
 * both async) — `runOnboard`'s own `OnboardDispatch` port is synchronous by
 * design (mirrors `PipelineModelPort`, see `packages/pipeline/src/run/
 * types.ts`), so this is never assigned directly as that port's `dispatch`;
 * `onboard-executor.ts`'s preflight-then-replay driver is what bridges the
 * two, exactly as `pipeline-routes/preflight.ts` does for the creation
 * pipeline. */
export type RealOnboardDispatch = (
  role: string,
  context: {
    readonly stepId: string;
    readonly seedContext: Readonly<Record<string, unknown>>;
    readonly priorArtifacts: Readonly<Record<string, unknown>>;
    readonly deliverables: readonly {
      readonly id: string;
      readonly producingRole: string;
    }[];
  },
) => Promise<OnboardStepArtifact>;

export interface CreateRealOnboardDispatchOptions {
  readonly config?: OnboardGatewayConfig;
  /** The repo being onboarded — `runSession`'s `cwd` (must be a real git
   * checkout; `computeChangedPaths` shells out to real `git`). */
  readonly repoRoot: string;
}

/** Builds the real dispatch function: renders a HANDOFF for the role, runs
 * it through the real `runSession` with a gateway-backed `spawn` (calls
 * `provider.chat`, never a child process — an analysis specialist has no
 * code to write), then defensively parses the session's stripped output as
 * an onboard completion (`onboard-types.ts`). */
export function createRealOnboardDispatch(
  opts: CreateRealOnboardDispatchOptions,
): RealOnboardDispatch {
  const config = opts.config ?? resolveOnboardGatewayConfigFromEnv();
  const provider: Provider = createOaiCompatProvider({
    id: 'onboard-run',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    fetchImpl: config.fetchImpl,
  });

  return async (role, context) => {
    const { runSession } = await loadLoopModule();

    const result = await runSession({
      handoff: {
        role,
        mission: `Analyze the repository and report ${role} findings for onboard step "${context.stepId}".`,
        ticket: { id: context.stepId, title: role },
        context: JSON.stringify({
          seedContext: context.seedContext,
          priorArtifacts: context.priorArtifacts,
        }),
        writeScope: [],
        produce: context.deliverables.map((d) => d.id),
        verify: 'true',
      },
      cwd: opts.repoRoot,
      spawn: async (input) => {
        const response = await provider.chat({
          model: config.model,
          messages: [
            { role: 'system', content: ONBOARD_SPECIALIST_SYSTEM_PROMPT },
            { role: 'user', content: input.prompt },
          ],
          temperature: 0,
        });
        return { stdout: response.message.content, stderr: '', exitCode: 0 };
      },
    });

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(result.output);
    } catch (err) {
      throw new MalformedModelOutputError(
        `onboard-dispatch:${role}`,
        `response was not valid JSON: ${(err as Error).message}`,
      );
    }
    const { summary, findings } = parseOnboardCompletion(
      parsedJson,
      `onboard-dispatch:${role}`,
    );

    return {
      stepId: context.stepId,
      role,
      summary,
      findings,
      session: { exitCode: result.exitCode, scopeViolations: result.scopeViolations },
    };
  };
}
