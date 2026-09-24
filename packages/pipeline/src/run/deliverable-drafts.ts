/**
 * A ticket per phase deliverable the project does not already have (W21-76),
 * and the verify that decides whether it is about THIS product (W23-37).
 *
 * THE GATE WAS RIGHT AND NOTHING FED IT (W21-76). `runPipeline` synthesizes a
 * blueprint and the interview produces implementation tickets; neither writes
 * `docs/VISION.md`, which is what phase 0 declares. So the gate refused on
 * every run for a stated, correct reason, and the project's Fleet card
 * honestly read "Not started" while real work landed.
 *
 * A TICKET RATHER THAN A SILENT WRITE: the gate exists so a phase is entered
 * on evidence, and the evidence should be something a ticket was actually
 * asked to produce — visible, orderable work a person can read, reorder or
 * delete. EVERY PHASE, NOT JUST IDEA (W22-11), filtered by
 * `isPathDeliverable`, the same rule the phase gate applies.
 *
 * W23-37: THE VERIFY COULD NOT FAIL FOR BOILERPLATE. Every one of these tickets
 * said "It reflects what the interview actually established, not a template"
 * and verified `test -s <path>`, whose only possible failure is an empty file.
 * Measured 2026-08-31: an expense tracker's VISION.md opened "This project aims
 * to deliver a clear, maintainable, and well-documented codebase" and the close
 * gate minted a receipt for it.
 *
 * MADE CHECKABLE, NOT DEMOTED — and demoting was measured first. The criterion
 * is prose, so the close gate already reported it as needing a human check on
 * every receipt (W21-41's humanCheckNotice); demoting it would have changed no
 * behaviour. What no machine checked was the verify. So the blueprint — which
 * `runPipeline` holds in memory at exactly this moment — supplies the product's
 * own terms, and the verify requires at least two distinct ones in the file.
 * Deterministic, no model call, and nothing read from `.dokima/blueprint.md`,
 * which a sandboxed verify in a ticket worktree cannot rely on reaching.
 *
 * WHAT IT DOES NOT PROVE, said plainly: a file that names the product's terms
 * can still be thin. The check separates "about this product" from "about
 * software in general" — the measured failure — and no more. The prose
 * criterion stays for the person accepting the ticket.
 *
 * NEVER A GREP THAT ALWAYS PASSES. A blueprint too thin to yield three usable
 * terms keeps `test -s`, and its criterion says outright that no machine
 * checks it, rather than a pattern that matches anything.
 */
import { isPathDeliverable, PHASES } from '../phases/topology.js';
import type { TicketDraftInput } from '../decompose/types.js';

/** Distinct product terms a deliverable must use to count as grounded. */
export const GROUNDING_MIN_MATCHES = 2;
/** Fewer candidate terms than this, and there is nothing honest to check. */
const MIN_TERMS = 3;
const MAX_TERMS = 8;
/** Title words say what the product IS; they outrank a word the body repeats. */
const TITLE_WEIGHT = 3;

/**
 * Words that appear in documents about any product, so finding them proves
 * nothing. English function words, and the vocabulary of software in general —
 * the words the measured boilerplate was made of.
 */
const GENERIC = new Set(
  (
    'about above after again also always among another because been before being ' +
    'below between both could does doing done during each either every from have ' +
    'having here into itself just least less like made make makes many might more ' +
    'most much must need needs never only other over same should since some such ' +
    'than that their them then there these they this those through under until ' +
    'upon very want wants well were what when where whether which while whom whose ' +
    'will with within without would your yours none' +
    ' project projects product products application applications app apps system ' +
    'systems software tool tools platform service services feature features ' +
    'function functions functionality user users customer customers person people ' +
    'someone something anyone everyone data information content document documents ' +
    'documentation codebase code module modules component components version ' +
    'simple easy clear clean maintainable scalable secure reliable robust modern ' +
    'future development developer developers foundation deliver delivers build ' +
    'builds building support supports provide provides allow allows able ' +
    'scope vision goal goals section sections open question questions ' +
    'decision complete decision-complete include includes including ' +
    // Verbs any product description uses — a boilerplate file uses them too.
    'show shows showing list lists listing record records recording track tracks ' +
    'tracking manage manages managing view views create creates update updates ' +
    'delete deletes store stores keep keeps know knows went just wants using used '
  ).split(/\s+/),
);

function termsIn(text: string): string[] {
  // A path names a file, not the product: `docs/VISION.md` is not vocabulary.
  const prose = text.replace(/\S*[/.]\S*\.[a-z]{2,4}\b/gi, ' ');
  return (prose.toLowerCase().match(/[a-z][a-z0-9-]*[a-z0-9]/g) ?? [])
    .filter((w) => w.length >= 4 && !GENERIC.has(w))
    .map(singular)
    .filter((w) => w.length >= 4 && !GENERIC.has(w));
}

/** `expenses` and `expense` are one concept; the verify folds them the same way. */
function singular(word: string): string {
  return word.length > 4 && word.endsWith('s') && !word.endsWith('ss')
    ? word.slice(0, -1)
    : word;
}

/**
 * The product's own vocabulary, most distinctive first: title words weighted,
 * then frequency, then first appearance. The Open Questions section is left
 * out — it is the gate's bookkeeping, not the product.
 */
export function groundingTerms(blueprintMarkdown: string): readonly string[] {
  const body = blueprintMarkdown.split(/^## Open Questions\b/m)[0] ?? '';
  const title = /^# (.+)$/m.exec(body)?.[1] ?? '';
  const score = new Map<string, number>();
  const order: string[] = [];
  const add = (word: string, weight: number): void => {
    if (!score.has(word)) order.push(word);
    score.set(word, (score.get(word) ?? 0) + weight);
  };
  for (const word of termsIn(title)) add(word, TITLE_WEIGHT);
  for (const word of termsIn(body.replace(/^#.*$/gm, ''))) add(word, 1);
  return order
    .map((word, index) => ({ word, index, weight: score.get(word)! }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .slice(0, MAX_TERMS)
    .map((t) => t.word);
}

/**
 * `test -s <path>`, plus — when the blueprint yields enough terms — a check
 * that at least GROUNDING_MIN_MATCHES distinct ones appear as whole words.
 * Terms are `[a-z0-9-]` only, so they are safe inside single quotes and as an
 * ERE alternation. A file with no match prints nothing and `awk` exits 1.
 */
export function groundedVerify(pathId: string, terms: readonly string[]): string | null {
  if (terms.length < MIN_TERMS) return null;
  const pattern = `(${terms.join('|')})s?`;
  return (
    `test -s ${pathId} && grep -oiwE '${pattern}' ${pathId} | ` +
    `tr '[:upper:]' '[:lower:]' | sed 's/s$//' | sort -u | ` +
    `awk 'END { exit NR < ${GROUNDING_MIN_MATCHES} }'`
  );
}

export function deliverableDrafts(
  existing: readonly string[],
  blueprintMarkdown: string,
): readonly TicketDraftInput[] {
  const have = new Set(existing);
  const terms = groundingTerms(blueprintMarkdown);
  const drafts: TicketDraftInput[] = [];
  // PHASES is already in gate order, which is the order these must appear in:
  // a phase cannot be entered before its own documents exist.
  for (const phase of PHASES) {
    for (const deliverable of phase.deliverables) {
      if (!isPathDeliverable(deliverable.id)) continue;
      if (have.has(deliverable.id)) continue;
      const grounded = groundedVerify(deliverable.id, terms);
      drafts.push({
        id: `PHASE${phase.id}-${deliverableSlug(deliverable.id)}`,
        type: 'task' as const,
        title: `Write ${deliverable.id}`,
        writeScope: [deliverable.id],
        dependsOn: [],
        acceptance: [
          `${deliverable.id} exists and is written for a reader who has not seen this project before`,
          grounded
            ? `It reflects what the interview actually established, not a template — verify ` +
              `requires at least ${GROUNDING_MIN_MATCHES} of the blueprint's own terms ` +
              `(${terms.join(', ')}); whether it says something true about them is for the person accepting it`
            : 'It reflects what the interview actually established, not a template — NO MACHINE ' +
              'CHECKS THIS: the blueprint was too thin to derive terms from, so verify only ' +
              'asserts the file is not empty',
        ],
        // The phase gate re-checks existence itself; the ticket's own verify
        // asserts the file is there, not empty, and about this product.
        verify: grounded ?? `test -s ${deliverable.id}`,
        // A doc-only ticket: no package, no code, no seams. Stated explicitly
        // rather than left off, because each is a seam the decomposer reasons
        // about and an omitted one is a guess.
        ownPackage: null,
        importsWorkspacePackages: [],
        providesInterfaces: [],
        consumesInterfaces: [],
      });
    }
  }
  return drafts;
}

/**
 * `docs/design/UX_SPEC.md` -> `design-UX_SPEC`. Keeps the id readable and
 * unique across phases: two phases could otherwise both yield `ARCHITECTURE`.
 */
function deliverableSlug(id: string): string {
  return id
    .replace(/^docs\//, '')
    .replace(/\.[^./]+$/, '')
    .replace(/\//g, '-');
}
