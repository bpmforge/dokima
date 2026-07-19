/**
 * Local port types for the Blueprint stage (Phase 2.5, FR-P7,
 * docs/BLUEPRINT.md §3.2's own genesis, productized).
 *
 * `BlueprintDocument` is deliberately thin — `{ version, markdown }` — and
 * carries no cached "is this decision-complete" flag. `gate.ts`'s
 * `decideBlueprintUnlock` always re-parses the raw markdown (and cross-
 * checks resolved markers against the real ledger) rather than trusting a
 * struct field a caller could have gone stale on or spoofed; a cached
 * `openQuestions` array here would just be a second copy of the truth for
 * that logic to disagree with (CLAUDE.md law #4: nothing completes on a
 * string match or a cached claim, the graded entity never grades itself).
 * `synth.ts` and `revision.ts` return the parsed/derived views (open
 * question slates, before/after markdown) as separate, explicitly-labelled
 * return values instead.
 *
 * This ticket's write_scope is `packages/pipeline/src/blueprint/**` only —
 * `packages/pipeline/package.json` is out of glob (same wall documented in
 * `../phases/types.ts` and `../decisions/types.ts`), so this module has no
 * reach to `@shipwright/events`/`@shipwright/loop` or to the filesystem.
 * The real `docs/BLUEPRINT.md` is never read or written here; a future
 * wiring ticket binds `synthesizeBlueprint`/`resolveOpenQuestion`'s pure
 * markdown transforms to the actual file, the same shape of gap
 * `decisions/ledger.ts` documents for `docs/DECISIONS.md`.
 */

/** A synthesized blueprint version — pure text, no filesystem reach (see header). */
export interface BlueprintDocument {
  readonly version: number;
  readonly markdown: string;
}

/** One condensed section of the blueprint (e.g. "Software Requirements (condensed)"). */
export interface BlueprintSectionInput {
  readonly heading: string;
  readonly body: string;
}

/** Only phases 3 (Design) and 4 (Build/decomposition) are locked by FR-P7. */
export type LockedPhaseId = 3 | 4;
