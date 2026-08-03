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
      const raw = await chatJson(
        provider,
        config.model,
        'blueprint-input',
        BLUEPRINT_SYSTEM_PROMPT,
        JSON.stringify({ title, drafts }),
      );
      return parseBlueprintInput(raw, title);
    },
    async resolveTechnicalSlateInput(blueprint) {
      const raw = await chatJson(
        provider,
        config.model,
        'technical-slate-input',
        TECHNICAL_SLATE_SYSTEM_PROMPT,
        JSON.stringify({ blueprintMarkdown: blueprint.document.markdown }),
      );
      return parseTechnicalSlateInput(raw);
    },
    async resolveTicketDrafts(blueprint, technicalSlate) {
      const raw = await chatJson(
        provider,
        config.model,
        'ticket-drafts',
        TICKET_DRAFTS_SYSTEM_PROMPT,
        JSON.stringify({
          blueprintMarkdown: blueprint.document.markdown,
          technicalSlate,
        }),
      );
      return parseTicketDrafts(raw);
    },
  };
}
