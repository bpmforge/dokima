/**
 * Real specialist dispatch for `runOnboard`'s `OnboardDispatch` seam (W8-09
 * AC1): every onboard/security-cluster/threat-model-refresh step's role is
 * run as a real `@dokima/loop` HANDOFF session — the exact contract
 * `packages/harbormaster/src/loop-claim.ts` uses to run a ticket's coding
 * session — except this session's `spawn` calls the real gateway
 * (`@dokima/gateway`'s `createOaiCompatProvider`, Law 6: model access
 * only through the gateway, never a direct provider) instead of a child
 * process CLI: an onboard/analysis specialist reads and reports on the repo,
 * it has no code to write, but it still goes through the same
 * role/mission/context/write-scope/produce/verify HANDOFF block, the same
 * thinking-strip, and the same real `git diff` write-scope check every
 * other specialist session does (`runSession`, `packages/loop/src/session.ts`).
 *
 * DYNAMIC IMPORT (not a static `from '@dokima/loop'`): this ticket's
 * write_scope is `apps/server/src/api/pipeline/**` + `.../cli/run-cmd.ts`
 * only — it does not include `apps/server/package.json`, so there is no
 * glob this ticket may use to add a declared workspace dependency on
 * `@dokima/loop` (pnpm's strict, non-hoisted linking means an
 * undeclared package is simply not resolvable via a static import here; the
 * SAME wall `packages/pipeline/src/plans/types.ts` and `phases/types.ts`
 * document for THEIR narrower write_scopes). The correct move on hitting
 * this wall is never to self-widen `write_scope` (confirmed the hard way on
 * W8-06: a maker's own edit to its own ticket's declared scope is treated as
 * illegitimate self-authorization regardless of whether the validator
 * tolerates the overlap).
 *
 * RESOLVED 2026-07-30 (W9-13). This used to `import()` the other package's
 * real `src/index.ts` by absolute `file://` URL, built by counting `..` hops
 * off `import.meta.url`. That was a write_scope workaround, not a design
 * choice — the header said so — and it does not survive packaging twice over:
 * the hops break under a bundle, and the target is a `.ts` SOURCE file that
 * plain `node` cannot import at all once `tsx` is out of the picture. This
 * ticket's scope includes `apps/server/package.json`, so `@dokima/loop`
 * is now a declared dependency and the specifier is a plain bare one. It stays
 * a dynamic `import()` deliberately — that preserves the lazy load and the
 * `loadLoopModuleForTests` seam — but a bare specifier is statically
 * analysable, so a bundler inlines it and `tsc` can type it.
 */
import { type Provider } from '@dokima/gateway';
// W10-59: shared with `gateway-model-port/chat-json.ts`, which had the
// identical bare `JSON.parse` on a model completion. A specialist that wraps
// its findings in a markdown fence used to fail the whole onboard step.
import { parseModelJson } from './model-json.js';
// Imported, never reimplemented (W10-45). `providerForConfig` constructs the
// adapter the resolved KIND names and refuses cloud kinds by name;
// `resolveGatewayConfigForProject` is the registry+matrix resolution W10-03
// built. Copying either here is what produced this unwired seam in the first
// place — W10_PLAN §6a traces it to exactly that habit.
import {
  providerForConfig,
  resolveGatewayConfigForProject,
  type GatewayConfig,
} from './gateway-model-port.js';
import { parseOnboardCompletion, type OnboardStepArtifact } from './onboard-types.js';

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

/** Loads the real `@dokima/loop` module exactly once per process. Dynamic
 * to keep the load lazy and to keep the `loadLoopModuleForTests` seam, but the
 * specifier is a plain bare one so it survives bundling (W9-13). */
function loadLoopModule(): Promise<LoopModule> {
  cachedLoopModule ??= import('@dokima/loop') as unknown as Promise<LoopModule>;
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
  /** Which adapter to construct. Absent => oai-compat, the pre-registry
   * behaviour, which is what the env fallback still resolves to. */
  readonly kind?: GatewayConfig['kind'];
  /** Which registry entry this came from, for provenance in traces. */
  readonly providerId?: string;
  /** Test-only override — real callers always get the real `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Local-first default (C-1): the same LM Studio-shaped localhost endpoint
 * `gateway-model-port.ts` defaults to.
 *
 * Kept as the DOCUMENTED override for CI and fixtures (the e2e fake-model
 * gateway sets these), and since W10-45 explicitly SECOND in line behind an
 * explicit registry+matrix selection. Still exported: `pipeline/index.ts`
 * re-exports it and `resolveModelTarget` falls back to the env path whenever
 * the registry or matrix is empty, which is a normal first-run state, not an
 * error.
 */
export function resolveOnboardGatewayConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OnboardGatewayConfig {
  return {
    baseUrl: env.DOKIMA_MODEL_BASE_URL ?? 'http://127.0.0.1:1234/v1',
    apiKey: env.DOKIMA_MODEL_API_KEY,
    // W13-36: never a guessed model id. The placeholder that used to sit here
    // matched nothing on a real endpoint; an empty id makes the provider say so
    // plainly instead of Dokima inventing a name.
    model: env.DOKIMA_MODEL_ID ?? '',
  };
}

const ONBOARD_SPECIALIST_SYSTEM_PROMPT =
  'You are a Dokima onboard/analysis specialist. You are given a HANDOFF ' +
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
  return async (role, context) => {
    const { runSession } = await loadLoopModule();

    // Resolved PER ROLE, inside the dispatch, not once at construction.
    // The role matrix is keyed role x task_type and every onboard step
    // dispatches a different specialist, so resolving once would wire the
    // seam and still route every specialist through one role's entry —
    // a quieter version of the bug this ticket exists to fix (W10-45).
    //
    // An explicit `config` still wins outright: that is the seam tests and
    // the e2e fake-model gateway drive.
    const config: OnboardGatewayConfig =
      opts.config ??
      (await resolveGatewayConfigForProject(opts.repoRoot, {
        role,
        taskType: 'reasoning',
      }));

    // `providerForConfig` (gateway-model-port.ts), not an unconditional
    // `createOaiCompatProvider`: it constructs the adapter the resolved KIND
    // names. W12-11 made it async (a credentialRef is resolved through the
    // keychain at construction time) and made anthropic/openai/copilot real;
    // it still refuses by name rather than falling back to
    // localhost. Imported rather than reimplemented — local reimplementation
    // is the documented cause of this seam being unwired in the first place.
    const provider: Provider = await providerForConfig({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      ...(config.kind ? { kind: config.kind } : {}),
      providerId: config.providerId ?? 'onboard-run',
      ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    });

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

    const parsedJson = parseModelJson(result.output, `onboard-dispatch:${role}`);
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
