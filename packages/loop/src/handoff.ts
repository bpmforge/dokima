/**
 * Typed HANDOFF contract + universal block renderer (BLUEPRINT §4). The
 * HANDOFF block is the bounded agent contract, rendered identically whether
 * dispatched to a child-process session, an API call, or pasted for a human
 * (docs/research/source-system-experts.md HANDOFF protocol). `packages/loop`
 * may not import `@dokima/tickets` (ARCHITECTURE.md §4 dependency
 * matrix) — `HandoffTicket` is a local, minimal projection of the two
 * ticket fields a HANDOFF needs, not the full ticket contract.
 */

import { redactDeep } from '@dokima/shared';

export interface HandoffTicket {
  readonly id: string;
  readonly title: string;
}

export interface Handoff {
  /** The specialist role, e.g. "coding-agent", "reviewer". */
  readonly role: string;
  /** One-line mission, rendered after the role on the ROLE line. */
  readonly mission: string;
  readonly ticket: HandoffTicket;
  /** Token-budgeted context packet (already assembled — packing is FR-L5's own concern). */
  readonly context: string;
  /** Exclusive globs; edits outside refuse to apply. */
  readonly writeScope: readonly string[];
  /** Acceptance criteria / exact deliverable paths. */
  readonly produce: readonly string[];
  /** The command/validator that must exit 0. */
  readonly verify: string;
}

const BLOCK_RULE = '═'.repeat(40);
/**
 * THE MANIFEST CONTRACT, STATED (W13-09).
 *
 * Found by the first supervised run. On a local model the agent did the work
 * correctly — wrote the function, ran verify to exit 0, committed it on its own
 * branch — and the loop then auto-blocked twice with "no completion manifest
 * returned" and released the ticket back to ready.
 *
 * The cause was not the model. `parseCompletionManifest` requires strict JSON
 * with `ticket`, `files[]`, `commits[]`, `evidence[]` and `verify{command,exit}`,
 * and the ONLY thing the model was ever told was one line of prose: "RETURN:
 * Completion Manifest (files produced, verify result, evidence)". Never that it
 * must be JSON, never the field names, never an example. The system asked in
 * words and validated against a schema, and a model writing prose in reply was
 * behaving reasonably.
 *
 * The parser is deliberately NOT loosened. It already tries three tiers and
 * strips thinking blocks; making it accept prose would mean accepting an
 * unverifiable claim, which is the opposite of what a manifest is for.
 *
 * THE EXAMPLE IS FILLED IN WITH THIS TICKET'S OWN VALUES, not a placeholder. A
 * schema a model has to infer is a schema it will get wrong, and that matters
 * most for a smaller local model — which is the configuration this product
 * guarantees works (C-1, D-024 option a).
 */
function returnBlock(ticketId: string, verify: string): string {
  return [
    'RETURN: when the work is done, reply with ONLY this JSON object and no',
    'other text. Every field is required.',
    '',
    '```json',
    JSON.stringify(
      {
        ticket: ticketId,
        files: ['path/you/changed.ts'],
        commits: ['the commit sha you made'],
        verify: { command: verify, exit: 0 },
        evidence: ['what you checked, and what it showed'],
      },
      null,
      2,
    ),
    '```',
  ].join('\n');
}

export interface RenderHandoffOptions {
  /**
   * Extra secret values to redact beyond known live-credential shapes
   * (SC-06) — typically the result of `collectSecretValues(vault,
   * projectDir)` (`@dokima/shared`), gathered by the caller before
   * rendering since collecting them is async (vault + `.env` file reads)
   * while `renderHandoff` itself stays sync (BLUEPRINT §4: it must run
   * inline wherever a HANDOFF is assembled, including synchronous
   * call sites). Omit to still get pattern-based redaction only.
   *
   * KNOWN LIMITATION (review LOW, tracked here per W3-17 acceptance
   * criterion 4): `collectSecretValues`'s `.env` loading
   * (`packages/shared/src/secrets/env-secrets.ts`) currently reads only a
   * single `.env` file in the project root — `.env.local` and
   * `.env.*.local` variants are not loaded. A secret that lives only in one
   * of those variant files will not appear in `secretValues` and will not
   * be redacted here. Widening `loadEnvFileSecretValues`/
   * `collectSecretValues` to the full variant set is out of this ticket's
   * write_scope (owned by W3-13, `packages/shared/src/secrets/**`).
   */
  readonly secretValues?: readonly string[];
}

/**
 * Renders a `Handoff` to the universal `════`-delimited block format
 * (BLUEPRINT §4). This is the universal choke point for every HANDOFF
 * regardless of which future ticket assembles the packet content (FR-L5):
 * `context`/`produce`/`verify` are redacted (SC-06, `redactDeep`) before the
 * block is returned, so a secret that slips past upstream assembly still
 * never reaches a spawned session, an API call, or a human's screen.
 */
export function renderHandoff(handoff: Handoff, opts: RenderHandoffOptions = {}): string {
  const secretValues = opts.secretValues ?? [];
  const context = redactDeep(handoff.context, secretValues);
  const produce = redactDeep(handoff.produce, secretValues);
  const verify = redactDeep(handoff.verify, secretValues);
  const lines = [
    BLOCK_RULE,
    `ROLE: ${handoff.role} — ${handoff.mission}`,
    `TICKET: ${handoff.ticket.id} ${handoff.ticket.title}`,
    `CONTEXT: ${context}`,
    `WRITE-SCOPE: ${handoff.writeScope.join(', ')}`,
    `PRODUCE: ${produce.join('; ')}`,
    `VERIFY: ${verify}`,
    returnBlock(handoff.ticket.id, verify),
    BLOCK_RULE,
  ];
  return lines.join('\n');
}
