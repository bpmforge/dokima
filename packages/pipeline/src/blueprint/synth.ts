/**
 * Blueprint synthesis (FR-P7 / AC-1: "Blueprint synthesized after Phase 2
 * with slate cards per open question"). The actual prose — the condensed
 * SRS summary, the preliminary architecture sketch — is authored elsewhere
 * (an injected LLM call, same seam shape as `interview/session.ts`'s
 * `InterviewDeps.draftDeliverable`); this module's job is assembling that
 * prose plus one `FOUNDER-DECISION` marker per open question into the
 * document structure `gate.ts` and `revision.ts` operate on.
 *
 * Every open question is built through `../decisions/founder-slate.ts`'s
 * `buildFounderSlate` (FR-P6's "2-4 options, one Recommended" shape) —
 * this module does not reimplement slate validation, it reuses the one
 * validator that already owns it (CLAUDE.md law #6).
 */
import { buildFounderSlate } from '../decisions/founder-slate.js';
import type { FounderSlateInput } from '../decisions/founder-slate.js';
import type { FounderSlate } from '../decisions/types.js';
import { assertValidOpenQuestionKey, formatUnresolvedMarkerLine } from './markers.js';
import type { BlueprintDocument, BlueprintSectionInput } from './types.js';

export class DuplicateOpenQuestionKeyError extends Error {
  constructor(key: string) {
    super(`open-question key "${key}" is used more than once in the same blueprint`);
    this.name = 'DuplicateOpenQuestionKeyError';
  }
}

/** A founder-owned fork surfaced while drafting the blueprint. */
export interface OpenQuestionInput {
  /** Stable across revisions — `revision.ts`'s `resolveOpenQuestion` keys on this. */
  readonly key: string;
  readonly slate: FounderSlateInput;
}

export interface SynthesizeBlueprintInput {
  readonly title: string;
  /** Condensed SRS + architecture sketch sections, in display order. */
  readonly sections: readonly BlueprintSectionInput[];
  readonly openQuestions: readonly OpenQuestionInput[];
}

export interface SynthesizedBlueprint {
  readonly document: BlueprintDocument;
  /** One per `input.openQuestions`, same order — AC-1's "slate cards per open question". */
  readonly slates: readonly FounderSlate[];
}

function renderOpenQuestionsSection(
  openQuestions: readonly OpenQuestionInput[],
  slates: readonly FounderSlate[],
): string {
  if (openQuestions.length === 0) {
    return '## Open Questions\n\nNone — decision-complete.';
  }
  const lines = openQuestions.map((oq, i) => {
    const slate = slates[i];
    if (!slate) throw new Error('slates and openQuestions must be the same length');
    return formatUnresolvedMarkerLine(oq.key, slate.title);
  });
  return `## Open Questions\n\n${lines.join('\n')}`;
}

/**
 * Assembles version 1 of the blueprint: the given condensed sections
 * followed by an Open Questions section carrying one unresolved marker per
 * `input.openQuestions`. Refuses (rather than silently deduplicating) a
 * reused open-question key, and refuses any malformed slate via
 * `buildFounderSlate` — a blueprint whose forks don't cleanly resolve to
 * real slate cards is not a valid synthesis output.
 */
export function synthesizeBlueprint(
  input: SynthesizeBlueprintInput,
): SynthesizedBlueprint {
  const seen = new Set<string>();
  for (const oq of input.openQuestions) {
    assertValidOpenQuestionKey(oq.key);
    if (seen.has(oq.key)) throw new DuplicateOpenQuestionKeyError(oq.key);
    seen.add(oq.key);
  }

  const slates = input.openQuestions.map((oq) => buildFounderSlate(oq.slate));

  const sectionBlocks = input.sections.map((s) => `## ${s.heading}\n\n${s.body}`);
  const openQuestionsBlock = renderOpenQuestionsSection(input.openQuestions, slates);

  const markdown = [`# ${input.title}`, ...sectionBlocks, openQuestionsBlock].join(
    '\n\n',
  );

  return { document: { version: 1, markdown }, slates };
}
