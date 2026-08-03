/**
 * gateway-model-port/blueprint-phase.ts — the blueprint phase prompt and its response parsing.
 *
 * Chapter of the 450-line gateway-model-port.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import { OPEN_QUESTION_KEY_RE, type SynthesizeBlueprintInput } from '@dokima/pipeline';
import { MalformedModelOutputError } from '../errors.js';
import { requireObject, requireArray, requireString } from '../json-shape.js';

/**
 * W10-66: the prompt used to say `"key": string` and nothing more, so a model
 * given a field called "key" beside a field called "title" reasonably wrote a
 * human-readable one — measured in a browser, `"Offline Sync & Conflict
 * Resolution Strategy"`. The system enforces a much narrower schema than the
 * one it described, and that gap was the defect.
 *
 * The constraint is not gratuitous and must not be loosened: the key becomes a
 * bare token inside a `<!-- FOUNDER-DECISION: <key> UNRESOLVED -->` sentinel
 * matched by a deliberately fail-closed grammar (packages/pipeline
 * blueprint/markers.ts), so a key with spaces would break FR-P7's phase lock.
 * Say so where the model can act on it, with a worked example rather than the
 * regex alone.
 */
export const BLUEPRINT_SYSTEM_PROMPT =
  'You are the Dokima blueprint synthesizer. Given a title and a list of ' +
  'interview deliverable drafts, respond with ONLY a JSON object of the shape ' +
  '{"sections": [{"heading": string, "body": string}], "openQuestions": ' +
  '[{"key": string, "slate": {"title": string, "options": ' +
  '[{"id": string, "label": string, "tradeoffs": string}], "recommendedId": ' +
  'string, "recommendedReasoning": string}}]}. "sections" condenses the ' +
  'drafts; "openQuestions" lists any founder-owned forks (2-4 options each, ' +
  'empty array if none). Each "key" is a short stable SLUG, not a title: ' +
  'lowercase words joined by hyphens, matching ' +
  `${OPEN_QUESTION_KEY_RE.source} — for example "offline-sync" or ` +
  '"deployment-shape". Put the human-readable wording in the slate\'s ' +
  '"title" instead. "recommendedId" must be one of the option ids you listed ' +
  'and must not be empty. Never fabricate a resolution — this endpoint has no ' +
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

/**
 * Validates the key AT THE PORT so a bad one is a phase-named
 * `MalformedModelOutputError` rather than a 422 raised further downstream.
 *
 * That placement is the whole point, and it is the decision this ticket was
 * asked to record. Two candidates were considered:
 *
 *   - SLUGIFY the title on the model's behalf. Rejected. The key is a stable
 *     identifier across runs, and two questions ("Offline sync?" / "Offline
 *     Sync") can slugify to one key, silently collapsing two founder decisions
 *     into one marker. Deriving an identifier the caller did not supply is
 *     inventing state at a trust boundary (law 4), not normalising it.
 *   - REJECT HERE, which is what this does. Raising at the port converts an
 *     unrecoverable downstream refusal into exactly the shape W10-65's
 *     gap-feedback retry already handles: the model is told which path was
 *     wrong and gets one bounded attempt to fix it. The prompt now states the
 *     rule, and this is the guarantee behind it — a prompt is guidance, a
 *     boundary is a contract.
 */
function requireKeySlug(value: unknown, phase: string, path_: string): string {
  const key = requireString(value, phase, path_);
  if (!OPEN_QUESTION_KEY_RE.test(key)) {
    throw new MalformedModelOutputError(
      phase,
      `"${path_}" must be a slug matching ${OPEN_QUESTION_KEY_RE.source} ` +
        `(for example "offline-sync"), got ${JSON.stringify(key)} — ` +
        'put the readable wording in the slate title instead',
    );
  }
  return key;
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
        key: requireKeySlug(q.key, phase, `openQuestions[${i}].key`),
        slate: parseFounderSlateInput(q.slate, phase, `openQuestions[${i}].slate`),
      };
    },
  );
  return { title, sections, openQuestions };
}
