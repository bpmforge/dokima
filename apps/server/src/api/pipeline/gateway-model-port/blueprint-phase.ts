/**
 * gateway-model-port/blueprint-phase.ts — the blueprint phase prompt and its response parsing.
 *
 * Chapter of the 450-line gateway-model-port.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import type { SynthesizeBlueprintInput } from '@dokima/pipeline';
import { requireObject, requireArray, requireString } from '../json-shape.js';

export const BLUEPRINT_SYSTEM_PROMPT =
  'You are the Dokima blueprint synthesizer. Given a title and a list of ' +
  'interview deliverable drafts, respond with ONLY a JSON object of the shape ' +
  '{"sections": [{"heading": string, "body": string}], "openQuestions": ' +
  '[{"key": string, "slate": {"title": string, "options": ' +
  '[{"id": string, "label": string, "tradeoffs": string}], "recommendedId": ' +
  'string, "recommendedReasoning": string}}]}. "sections" condenses the ' +
  'drafts; "openQuestions" lists any founder-owned forks (2-4 options each, ' +
  'empty array if none). Never fabricate a resolution — this endpoint has no ' +
  'authority to mark a question decided.';

export function parseFounderSlateInput(
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

export function parseBlueprintInput(
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

