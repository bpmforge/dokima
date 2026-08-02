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
 */
import { createOaiCompatProvider, type Provider } from '@dokima/gateway';
import type {
  DeliverableDraft,
  SynthesizeBlueprintInput,
  SynthesizedBlueprint,
  TechnicalSlateInput,
  TechnicalSlate,
  TicketDraftInput,
} from '@dokima/pipeline';
import { MalformedModelOutputError } from './errors.js';
import {
  requireArray,
  requireObject,
  requireOptionalArray,
  requireString,
} from './json-shape.js';

export { MalformedModelOutputError };

export interface GatewayConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  /** Test-only override — real callers always get the real `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/** Local-first default (C-1): an LM Studio-shaped endpoint on localhost, zero network required. */
export function resolveGatewayConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  return {
    baseUrl: env.DOKIMA_MODEL_BASE_URL ?? 'http://127.0.0.1:1234/v1',
    apiKey: env.DOKIMA_MODEL_API_KEY,
    model: env.DOKIMA_MODEL_ID ?? 'local-model',
  };
}

async function chatJson(
  provider: Provider,
  model: string,
  phase: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<Record<string, unknown>> {
  const response = await provider.chat({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0,
  });
  const content = response.message.content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new MalformedModelOutputError(
      phase,
      `response was not valid JSON: ${(err as Error).message}`,
    );
  }
  return requireObject(parsed, phase, '<response>');
}

const BLUEPRINT_SYSTEM_PROMPT =
  'You are the Dokima blueprint synthesizer. Given a title and a list of ' +
  'interview deliverable drafts, respond with ONLY a JSON object of the shape ' +
  '{"sections": [{"heading": string, "body": string}], "openQuestions": ' +
  '[{"key": string, "slate": {"title": string, "options": ' +
  '[{"id": string, "label": string, "tradeoffs": string}], "recommendedId": ' +
  'string, "recommendedReasoning": string}}]}. "sections" condenses the ' +
  'drafts; "openQuestions" lists any founder-owned forks (2-4 options each, ' +
  'empty array if none). Never fabricate a resolution — this endpoint has no ' +
  'authority to mark a question decided.';

function parseFounderSlateInput(
  raw: unknown,
  phase: string,
  path_: string,
): {
  title: string;
  options: { id: string; label: string; tradeoffs: string }[];
  recommendedId: string;
  recommendedReasoning: string;
} {
  const slate = requireObject(raw, phase, path_);
  const options = requireArray(slate.options, phase, `${path_}.options`).map((opt, i) => {
    const o = requireObject(opt, phase, `${path_}.options[${i}]`);
    return {
      id: requireString(o.id, phase, `${path_}.options[${i}].id`),
      label: requireString(o.label, phase, `${path_}.options[${i}].label`),
      tradeoffs: requireString(o.tradeoffs, phase, `${path_}.options[${i}].tradeoffs`),
    };
  });
  return {
    title: requireString(slate.title, phase, `${path_}.title`),
    options,
    recommendedId: requireString(slate.recommendedId, phase, `${path_}.recommendedId`),
    recommendedReasoning: requireString(
      slate.recommendedReasoning,
      phase,
      `${path_}.recommendedReasoning`,
    ),
  };
}

function parseBlueprintInput(
  raw: Record<string, unknown>,
  title: string,
): SynthesizeBlueprintInput {
  const phase = 'blueprint-input';
  const sections = requireArray(raw.sections, phase, 'sections').map((s, i) => {
    const section = requireObject(s, phase, `sections[${i}]`);
    return {
      heading: requireString(section.heading, phase, `sections[${i}].heading`),
      body: requireString(section.body, phase, `sections[${i}].body`),
    };
  });
  const openQuestions = requireArray(raw.openQuestions, phase, 'openQuestions').map(
    (oq, i) => {
      const q = requireObject(oq, phase, `openQuestions[${i}]`);
      return {
        key: requireString(q.key, phase, `openQuestions[${i}].key`),
        slate: parseFounderSlateInput(q.slate, phase, `openQuestions[${i}].slate`),
      };
    },
  );
  return { title, sections, openQuestions };
}

const TECHNICAL_SLATE_SYSTEM_PROMPT =
  'You are the Dokima technical-fork slate builder. Given the current ' +
  'blueprint markdown, respond with ONLY a JSON object of the shape ' +
  '{"title": string, "options": [{"label": "Minimal"|"Clean"|"Pragmatic", ' +
  '"summary": string, "dimensions": {"time": string, "maintainability": ' +
  'string, "scalability": string, "team-fit": string, "risk": string, ' +
  '"reversibility": string}}], "recommendedLabel": "Minimal"|"Clean"|' +
  '"Pragmatic", "recommendedConstraint": string}. Exactly 3 options, one per ' +
  'label, every dimension scored on every option, recommendation tied to a ' +
  'named constraint (never a bare preference).';

function parseTechnicalSlateInput(raw: Record<string, unknown>): TechnicalSlateInput {
  const phase = 'technical-slate-input';
  const options = requireArray(raw.options, phase, 'options').map((o, i) => {
    const opt = requireObject(o, phase, `options[${i}]`);
    const dims = requireObject(opt.dimensions, phase, `options[${i}].dimensions`);
    const dimensions: Record<string, string> = {};
    for (const key of [
      'time',
      'maintainability',
      'scalability',
      'team-fit',
      'risk',
      'reversibility',
    ]) {
      dimensions[key] = requireString(
        dims[key],
        phase,
        `options[${i}].dimensions.${key}`,
      );
    }
    return {
      label: requireString(
        opt.label,
        phase,
        `options[${i}].label`,
      ) as TechnicalSlateInput['options'][number]['label'],
      summary: requireString(opt.summary, phase, `options[${i}].summary`),
      dimensions,
    };
  });
  return {
    title: requireString(raw.title, phase, 'title'),
    options,
    recommendedLabel: requireString(
      raw.recommendedLabel,
      phase,
      'recommendedLabel',
    ) as TechnicalSlateInput['recommendedLabel'],
    recommendedConstraint: requireString(
      raw.recommendedConstraint,
      phase,
      'recommendedConstraint',
    ),
  };
}

const TICKET_DRAFTS_SYSTEM_PROMPT =
  'You are the Dokima task decomposer specialist. Given the blueprint ' +
  'markdown and the decided technical slate, respond with ONLY a JSON object ' +
  'of the shape {"tickets": [{"id": string, "type": "epic"|"story"|"task"|' +
  '"bug", "title": string, "writeScope": string[], "dependsOn": string[], ' +
  '"acceptance": string[], "verify": string, "ownPackage": string|null, ' +
  '"importsWorkspacePackages": string[], "providesInterfaces": ' +
  '[{"packageName": string, "exportName": string}], "consumesInterfaces": ' +
  '[{"packageName": string, "exportName": string}]}]}. "verify" is an ' +
  'executable shell command. "dependsOn" entries must reference another ' +
  'ticket id in this same list.';

function parseInterfaceRefs(
  raw: unknown,
  phase: string,
  path_: string,
): { packageName: string; exportName: string }[] {
  return requireOptionalArray(raw, phase, path_).map((ref, i) => {
    const r = requireObject(ref, phase, `${path_}[${i}]`);
    return {
      packageName: requireString(r.packageName, phase, `${path_}[${i}].packageName`),
      exportName: requireString(r.exportName, phase, `${path_}[${i}].exportName`),
    };
  });
}

function parseTicketDrafts(raw: Record<string, unknown>): readonly TicketDraftInput[] {
  const phase = 'ticket-drafts';
  return requireArray(raw.tickets, phase, 'tickets').map((t, i) => {
    const draft = requireObject(t, phase, `tickets[${i}]`);
    const writeScope = requireArray(
      draft.writeScope,
      phase,
      `tickets[${i}].writeScope`,
    ).map((s, j) => requireString(s, phase, `tickets[${i}].writeScope[${j}]`));
    const dependsOn = requireArray(draft.dependsOn, phase, `tickets[${i}].dependsOn`).map(
      (s, j) => requireString(s, phase, `tickets[${i}].dependsOn[${j}]`),
    );
    const acceptance = requireArray(
      draft.acceptance,
      phase,
      `tickets[${i}].acceptance`,
    ).map((s, j) => requireString(s, phase, `tickets[${i}].acceptance[${j}]`));
    const ownPackage = draft.ownPackage;
    if (ownPackage !== null && typeof ownPackage !== 'string') {
      throw new MalformedModelOutputError(
        phase,
        `tickets[${i}].ownPackage must be a string or null`,
      );
    }
    return {
      id: requireString(draft.id, phase, `tickets[${i}].id`),
      type: requireString(
        draft.type,
        phase,
        `tickets[${i}].type`,
      ) as TicketDraftInput['type'],
      title: requireString(draft.title, phase, `tickets[${i}].title`),
      writeScope,
      dependsOn,
      acceptance,
      verify: requireString(draft.verify, phase, `tickets[${i}].verify`),
      ownPackage,
      importsWorkspacePackages: requireOptionalArray(
        draft.importsWorkspacePackages,
        phase,
        `tickets[${i}].importsWorkspacePackages`,
      ).map((s, j) =>
        requireString(s, phase, `tickets[${i}].importsWorkspacePackages[${j}]`),
      ),
      providesInterfaces: parseInterfaceRefs(
        draft.providesInterfaces,
        phase,
        `tickets[${i}].providesInterfaces`,
      ),
      consumesInterfaces: parseInterfaceRefs(
        draft.consumesInterfaces,
        phase,
        `tickets[${i}].consumesInterfaces`,
      ),
    };
  });
}

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
  const provider = createOaiCompatProvider({
    id: 'pipeline-run',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    fetchImpl: config.fetchImpl,
  });

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
