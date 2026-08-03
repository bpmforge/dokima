/**
 * Parsing a JSON object out of a model completion (W10-59).
 *
 * Every system prompt that asks for JSON in this package already says
 * "respond with ONLY a JSON object" — three of them do, verbatim. Instruct
 * models wrap it in a markdown fence anyway, which is how the creation
 * pipeline died in a browser on 2026-08-03: blueprint and technical-slate
 * both completed against a real local model, then ticket-drafts returned
 * ```json { ... } ``` and `JSON.parse` threw on the first backtick. Roughly
 * 76s of real inference was discarded for a formatting habit.
 *
 * Prompting harder is not the fix. A model that complies 95% of the time
 * still fails a three-phase pipeline 14% of the time, and each failure throws
 * away every phase before it.
 *
 * What this is NOT: a JSON repairer. It removes a wrapper the model added
 * around output that is otherwise exactly what was asked for. It never
 * invents structure, never closes an unbalanced brace, never guesses at a
 * truncated response — a completion with no parseable JSON object in it still
 * raises, naming its phase. Inventing structure at a trust boundary is what
 * law 4 exists to prevent, and a parser that always succeeds is not a parser.
 */

import { MalformedModelOutputError } from './errors.js';
import { requireObject } from './json-shape.js';

/**
 * A fenced block, anywhere in the completion. Tolerates:
 *   - ``` or ~~~ fences, 3+ markers
 *   - an optional language tag (```json, ```JSON, ```js)
 *   - prose before the fence ("Here is the JSON:") and after it
 *   - an unterminated closing fence, which truncated completions produce
 *
 * Non-greedy body, so the FIRST fenced block wins rather than everything
 * between the first opening fence and the last closing one — a model that
 * emits two blocks should have its first parsed, not the pair concatenated
 * into garbage.
 */
const FENCED_BLOCK =
  /(?:`{3,}|~{3,})[ \t]*[A-Za-z0-9_+-]*[ \t]*\r?\n([\s\S]*?)(?:`{3,}|~{3,}|$)/;

/**
 * Strips a markdown code fence if the content is wrapped in one. Returns the
 * input unchanged when there is no fence — the common, already-working case
 * pays nothing but one regex test.
 */
export function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith('```') && !trimmed.startsWith('~~~')) {
    // A fence that starts mid-string is only interesting if the completion is
    // not already parseable on its own; `parseModelJson` handles that order.
    return content;
  }
  const match = FENCED_BLOCK.exec(trimmed);
  return match?.[1] === undefined ? content : match[1];
}

/**
 * Parses a model completion into a JSON object, tolerating a markdown fence.
 *
 * Order matters: a clean completion parses on the first attempt and never
 * touches the fence logic, so the fix cannot change the behaviour of output
 * that already worked. Only a parse failure falls back to fence stripping,
 * and only then to a fence found mid-string (prose-then-fence).
 *
 * @param phase names the pipeline phase in any refusal, so a failure says
 * which of the sequential calls produced it.
 */
export function parseModelJson(content: string, phase: string): Record<string, unknown> {
  for (const candidate of parseCandidates(content)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    return requireObject(parsed, phase, '<response>');
  }
  throw new MalformedModelOutputError(
    phase,
    `response was not valid JSON: ${describe(content)}`,
  );
}

/** The strings worth attempting, cheapest and most likely first. */
function* parseCandidates(content: string): Generator<string> {
  yield content;
  const stripped = stripCodeFence(content);
  if (stripped !== content) yield stripped;
  // Prose before the fence ("Here is the JSON:\n```json\n{...}"), which the
  // leading-marker check above deliberately does not treat as fenced.
  const embedded = FENCED_BLOCK.exec(content);
  if (embedded?.[1] !== undefined && embedded[1] !== stripped) yield embedded[1];
}

/** A refusal has to be diagnosable without dumping a whole completion into a log. */
function describe(content: string): string {
  const head = content.trim().slice(0, 120);
  return head === '' ? 'the completion was empty' : `no JSON object found in ${head}`;
}
