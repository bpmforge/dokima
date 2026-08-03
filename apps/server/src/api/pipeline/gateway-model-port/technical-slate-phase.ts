/**
 * gateway-model-port/technical-slate-phase.ts — the technical-slate phase prompt and its response parsing.
 *
 * Chapter of the 450-line gateway-model-port.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import type { TechnicalSlateInput } from '@dokima/pipeline';
import { requireObject, requireArray, requireString } from '../json-shape.js';

export const TECHNICAL_SLATE_SYSTEM_PROMPT =
  'You are the Dokima technical-fork slate builder. Given the current ' +
  'blueprint markdown, respond with ONLY a JSON object of the shape ' +
  '{"title": string, "options": [{"label": "Minimal"|"Clean"|"Pragmatic", ' +
  '"summary": string, "dimensions": {"time": string, "maintainability": ' +
  'string, "scalability": string, "team-fit": string, "risk": string, ' +
  '"reversibility": string}}], "recommendedLabel": "Minimal"|"Clean"|' +
  '"Pragmatic", "recommendedConstraint": string}. Exactly 3 options, one per ' +
  'label, every dimension scored on every option, recommendation tied to a ' +
  'named constraint (never a bare preference).';

export function parseTechnicalSlateInput(raw: Record<string, unknown>): TechnicalSlateInput {
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

