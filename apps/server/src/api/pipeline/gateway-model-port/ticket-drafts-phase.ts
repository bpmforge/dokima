/**
 * gateway-model-port/ticket-drafts-phase.ts — the ticket-drafts phase prompt and its response parsing.
 *
 * Chapter of the 450-line gateway-model-port.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import type { TicketDraftInput } from '@dokima/pipeline';
import { MalformedModelOutputError } from '../errors.js';
import { requireObject, requireArray, requireOptionalArray, requireString } from '../json-shape.js';

export const TICKET_DRAFTS_SYSTEM_PROMPT =
  'You are the Dokima task decomposer specialist. Given the blueprint ' +
  'markdown and the decided technical slate, respond with ONLY a JSON object ' +
  'of the shape {"tickets": [{"id": string, "type": "epic"|"story"|"task"|' +
  '"bug", "title": string, "writeScope": string[], "dependsOn": string[], ' +
  '"acceptance": string[], "verify": string, "ownPackage": string|null, ' +
  '"importsWorkspacePackages": string[], "providesInterfaces": ' +
  '[{"packageName": string, "exportName": string}], "consumesInterfaces": ' +
  '[{"packageName": string, "exportName": string}]}]}. ' +
  // W10-76: the prompt used to describe "writeScope": string[] and stop, and a
  // model given a field beside "acceptance" reasonably filled it with the
  // acceptance criteria in prose — measured on a real board, 8 of 8 tickets
  // carried sentences like "Initialize Supabase project on free tier" while
  // the verify command sat in "acceptance". The system enforces something far
  // narrower than it described: a scope is compiled with a glob matcher, so a
  // sentence matches no file and every change an agent makes is refused as
  // out of scope. Say what the field IS, with worked examples, exactly as
  // W10-66 had to for the blueprint's "key".
  '"writeScope" is the FILE PATHS AND GLOBS this ticket may edit — never ' +
  'prose, never acceptance criteria. Each entry is a repo-relative path or ' +
  'glob with no spaces, for example "src/db/schema.ts", "src/services/**" or ' +
  '"apps/web/package.json". "acceptance" is the list of criteria a human ' +
  'would check, in plain language. "verify" is a single executable shell ' +
  'command, and belongs nowhere else. "dependsOn" entries must reference ' +
  'another ticket id in this same list.';

export function parseInterfaceRefs(
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

export function parseTicketDrafts(raw: Record<string, unknown>): readonly TicketDraftInput[] {
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

