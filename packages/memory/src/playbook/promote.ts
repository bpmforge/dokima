/**
 * Global promotion (BLUEPRINT §3.11, DATABASE.md §7, FR-F5): per-project
 * playbook entries stay local by default; a project-agnostic lesson may be
 * promoted to the Fleet-scope global playbook only explicitly, carrying
 * provenance, and never automatically. This module never talks to the
 * global DB itself — `packages/memory` can't depend on `@dokima/events`
 * (no workspace dependency declared in this ticket's write_scope) — it only
 * *prepares* the exact payload shape
 * `packages/events/src/global-db/global-playbook.ts`'s real
 * `promoteGlobalPlaybookEntry` expects. `promote.test.ts` proves the
 * structural match by dynamically importing that real function and feeding
 * it this module's output.
 *
 * "Never automatic" holds structurally: no function in `consult.ts` or
 * `playbook.ts` calls (or even has a reference to) anything in this file —
 * promotion is only reachable through this module's own explicit,
 * actor-required entry point.
 */
import { getPlaybookEntryById } from './playbook.js';
import type { SqliteHandle } from '../store/handle.js';

export interface PreparePromotionInput {
  readonly entryId: number;
  /** Identifies the source project this entry is being promoted from (DATABASE.md §7's `promoted_from_project`). */
  readonly promotedFromProject: string;
  /** Human or reviewer identity id — never empty (FR-F5: promotion is never automatic). */
  readonly promotedBy: string;
}

/** The exact shape `@dokima/events`' `promoteGlobalPlaybookEntry` (`PromoteGlobalPlaybookInput`) expects, reproduced rather than imported. */
export interface GlobalPromotionPayload {
  readonly taskClass: string;
  readonly entry: string;
  readonly version: number;
  readonly verifiedBy: string;
  readonly deltaOf: number | null;
  readonly promotedFromProject: string;
  readonly sourceEntryId: number;
  readonly promotedBy: string;
}

export class MissingPromotionActorError extends Error {
  constructor() {
    super(
      'playbook promotion requires an explicit human/reviewer promotedBy — ' +
        'promotion is never automatic (FR-F5)',
    );
    this.name = 'MissingPromotionActorError';
  }
}

export class PlaybookEntryNotFoundError extends Error {
  constructor(public readonly entryId: number) {
    super(`no playbook entry with id ${entryId} to promote`);
    this.name = 'PlaybookEntryNotFoundError';
  }
}

/**
 * Prepares an explicit, provenance-carrying promotion payload for a local
 * playbook entry. Throws `MissingPromotionActorError` for a blank
 * `promotedBy` and `PlaybookEntryNotFoundError` for an unknown `entryId` —
 * there is no path through this function that produces a payload without a
 * named actor and a real source entry.
 */
export function preparePlaybookPromotion(
  handle: SqliteHandle,
  input: PreparePromotionInput,
): GlobalPromotionPayload {
  if (!input.promotedBy || input.promotedBy.trim() === '') {
    throw new MissingPromotionActorError();
  }
  const entry = getPlaybookEntryById(handle, input.entryId);
  if (!entry) {
    throw new PlaybookEntryNotFoundError(input.entryId);
  }
  return {
    taskClass: entry.taskClass,
    entry: entry.entry,
    version: entry.version,
    verifiedBy: entry.verifiedBy,
    deltaOf: null,
    promotedFromProject: input.promotedFromProject,
    sourceEntryId: entry.id,
    promotedBy: input.promotedBy,
  };
}
