/**
 * Real-gateway adapter for `runPipeline`'s `PipelineModelPort` (CLAUDE.md
 * law #6: model access only via `@dokima/gateway`, never a direct
 * provider). `runPipeline` (`packages/pipeline/src/run/run-pipeline.ts`) and
 * its port methods are synchronous by design (see `pipeline-routes/index.ts`'s
 * module header for why), but a gateway call is inherently async — so this
 * module does not implement `PipelineModelPort` directly. It exposes three
 * async "resolve" functions the route calls in a pre-flight pass (gateway
 * call -> pure phase replay -> next gateway call, threading real synthesized
 * content the same way `runPipeline` itself does), and `pipeline-routes/index.ts`
 * hands the *cached results* to `runPipeline` through a trivial synchronous
 * port.
 *
 * SECURITY_W5 MEDIUM FIX: `@dokima/gateway` is now a proper workspace
 * dependency (`apps/server/package.json`), so it is a normal, statically
 * resolvable import — no more sidestepping pnpm's per-package `node_modules`
 * linking with a hand-constructed `file://` URL off `import.meta.url`.
 *
 * W10-48: this file was 450 lines, over the 400-line CODE_BOOK_PROTOCOL cap.
 * Config resolution, provider construction, the chat-JSON helper and the three
 * prompt-driven phases now live in `gateway-model-port/` chapters. What stays
 * here is the port assembly — the thing the module is actually named for.
 *
 * It keeps this exact path deliberately: `pipeline-routes/index.ts` and
 * `onboard-dispatch-port.ts` (wired in W10-45) import `./gateway-model-port.js`
 * by name, and ESM has no directory-index resolution, so the split moves no
 * call site.
 */
import type {
  DeliverableDraft,
  SynthesizeBlueprintInput,
  SynthesizedBlueprint,
  TechnicalSlate,
  TechnicalSlateInput,
  TicketDraftInput,
} from '@dokima/pipeline';
import { MalformedModelOutputError } from './errors.js';
import {
  resolveGatewayConfigFromEnv,
  type GatewayConfig,
} from './gateway-model-port/config.js';
import { providerForConfig } from './gateway-model-port/provider.js';
import { chatJson } from './gateway-model-port/chat-json.js';
import {
  BLUEPRINT_SYSTEM_PROMPT,
  parseBlueprintInput,
} from './gateway-model-port/blueprint-phase.js';
import {
  TECHNICAL_SLATE_SYSTEM_PROMPT,
  parseTechnicalSlateInput,
} from './gateway-model-port/technical-slate-phase.js';
import {
  TICKET_DRAFTS_SYSTEM_PROMPT,
  parseTicketDrafts,
} from './gateway-model-port/ticket-drafts-phase.js';

// Re-exported unchanged: W10-45 wired onboard-dispatch-port.ts to
// `providerForConfig` and `resolveGatewayConfigForProject`, so dropping either
// from this surface would re-unwire the seam that ticket just closed.
export { MalformedModelOutputError };
export {
  resolveGatewayConfigFromEnv,
  resolveGatewayConfigForProject,
  type GatewayConfig,
} from './gateway-model-port/config.js';
export { providerForConfig } from './gateway-model-port/provider.js';

export interface RealGatewayPort {
  readonly resolveBlueprintInput: (
    drafts: readonly DeliverableDraft[],
    title: string,
  ) => Promise<SynthesizeBlueprintInput>;
  readonly resolveTechnicalSlateInput: (
    blueprint: SynthesizedBlueprint,
  ) => Promise<TechnicalSlateInput>;
  readonly resolveTicketDrafts: (
    blueprint: SynthesizedBlueprint,
    technicalSlate: TechnicalSlate,
  ) => Promise<readonly TicketDraftInput[]>;
}

/**
 * W10-65: one bounded retry, with the validation failure fed back.
 *
 * This is W1-03's micro-loop shape — criterion, gap, feedback, retry — applied
 * to the one place that had no loop at all. Before this, a phase was a single
 * shot: a local model that returned well-formed JSON of the right general
 * shape but left `openQuestions[0].slate.recommendedId` empty threw away the
 * entire run, including the phases that had already succeeded. Measured in a
 * browser on 2026-08-03; the same code had passed that phase on a different
 * idea minutes earlier, so it is input-dependent variance, not a bug in the
 * model or the parser.
 *
 * DECIDED, per the ticket's own instruction to choose rather than do both:
 * feed the gap back, do NOT loosen the schema. `recommendedId` is not
 * gratuitous strictness — `buildFounderSlate`
 * (packages/pipeline/src/decisions/founder-slate.ts:42) refuses a slate whose
 * `recommendedId` is not among its options, deliberately ("a slate with the
 * wrong option count is not a smaller problem to paper over"). Accepting an
 * empty one here would move the same refusal one layer deeper and lose the
 * phase name on the way.
 *
 * EXACTLY ONE retry, and only for `MalformedModelOutputError`. A provider
 * timeout or transport failure is NOT retried: those are the adapter's
 * business, the local default is 300s, and re-issuing one would double a wait
 * a user is already holding a tab open for. A retry that never gives up is a
 * hang, not a fix.
 */
async function withGapFeedback<T>(
  provider: ReturnType<typeof providerForConfig>,
  model: string,
  phase: string,
  systemPrompt: string,
  userPrompt: string,
  parse: (raw: Record<string, unknown>) => T,
): Promise<T> {
  try {
    return parse(await chatJson(provider, model, phase, systemPrompt, userPrompt));
  } catch (err) {
    if (!(err instanceof MalformedModelOutputError)) throw err;

    // The gap, stated as the validator stated it. Naming the exact path the
    // model got wrong is the whole point — "try again" without the reason is
    // just a second roll of the same dice.
    const retryPrompt =
      `${userPrompt}\n\nYour previous response was rejected: ${err.message}\n` +
      'Return the corrected JSON object only. Fix that specific problem and ' +
      'keep everything else you produced.';

    try {
      return parse(await chatJson(provider, model, phase, systemPrompt, retryPrompt));
    } catch (retryErr) {
      if (!(retryErr instanceof MalformedModelOutputError)) throw retryErr;
      throw new MalformedModelOutputError(
        phase,
        `${retryErr.message} (after one retry with the gap fed back; the first attempt failed with: ${err.message})`,
      );
    }
  }
}

/**
 * Builds the real port. `config` defaults to env-resolved local-first
 * settings (`resolveGatewayConfigFromEnv`); tests inject a `fetchImpl`
 * pointed at a fake OpenAI-compatible HTTP server instead of a live one
 * (Law 9 — no network in CI).
 */
export async function createRealGatewayPort(
  config: GatewayConfig = resolveGatewayConfigFromEnv(),
): Promise<RealGatewayPort> {
  const provider = providerForConfig(config);

  return {
    async resolveBlueprintInput(drafts, title) {
      return withGapFeedback(
        provider,
        config.model,
        'blueprint-input',
        BLUEPRINT_SYSTEM_PROMPT,
        JSON.stringify({ title, drafts }),
        (raw) => parseBlueprintInput(raw, title),
      );
    },
    async resolveTechnicalSlateInput(blueprint) {
      return withGapFeedback(
        provider,
        config.model,
        'technical-slate-input',
        TECHNICAL_SLATE_SYSTEM_PROMPT,
        JSON.stringify({ blueprintMarkdown: blueprint.document.markdown }),
        parseTechnicalSlateInput,
      );
    },
    async resolveTicketDrafts(blueprint, technicalSlate) {
      return withGapFeedback(
        provider,
        config.model,
        'ticket-drafts',
        TICKET_DRAFTS_SYSTEM_PROMPT,
        JSON.stringify({
          blueprintMarkdown: blueprint.document.markdown,
          technicalSlate,
        }),
        parseTicketDrafts,
      );
    },
  };
}
