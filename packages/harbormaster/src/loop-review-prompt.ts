/**
 * The reviewer's prompt and the reply parser (W23-04) — a chapter of
 * `loop-review.ts` under the 400-line CODE_BOOK_PROTOCOL cap. Extraction
 * only: no wording and no parsing rule changed in the move.
 *
 * Kept together because they are two halves of one contract. The prompt ends
 * by demanding a specific JSON shape and `diagnoseVerdict` is the only thing that
 * reads it, so a change to either that is not a change to the other is a bug
 * — and putting them in one file makes that visible in one diff.
 */

import type { Ticket } from '@dokima/tickets';
import { formatRerunLine, type RerunEvidence } from '@dokima/loop';
import { reviewEvidenceSection, type ReviewEvidenceBundle } from './review-evidence.js';
import type { ReviewVerdictKind } from './loop-review.js';

/** Test-count extraction is best-effort; the contract only demands a non-empty counts record, and `commandsRun` is always true. */
export function countsFrom(output: string): Record<string, number> {
  const counts: Record<string, number> = { commandsRun: 1 };
  const passed = /(\d+)\s+(?:tests? )?pass(?:ed|ing)/i.exec(output);
  if (passed) counts.passed = Number(passed[1]);
  const failed = /(\d+)\s+(?:tests? )?fail(?:ed|ing)/i.exec(output);
  if (failed) counts.failed = Number(failed[1]);
  return counts;
}

export function reviewPrompt(
  ticket: Ticket,
  rerun: RerunEvidence,
  rerunOutputHead: string,
  evidence: ReviewEvidenceBundle,
  securitySection: string,
): string {
  const acceptance = ticket.acceptance
    .map((criterion) => `- ${criterion.text}`)
    .join('\n');
  const files = (ticket.manifest?.files ?? []).join(', ') || '(none listed)';
  return [
    `You are reviewing finished work on ticket ${ticket.id}: ${ticket.title}`,
    `Acceptance criteria:\n${acceptance || '- (none recorded)'}`,
    // W23-03: the DIFF, not a list of filenames. Before this the reviewer was
    // shown which files moved and asked whether the work was correct — a
    // question no reader of a file list can answer, and one a passing test
    // suite answers wrongly for any change that is insecure rather than broken.
    reviewEvidenceSection(evidence),
    securitySection,
    `Files changed (manifest): ${files}`,
    `Commits: ${(ticket.manifest?.commits ?? []).join(', ') || '(none)'}`,
    `The core re-ran the verify command independently: ${formatRerunLine(rerun)}`,
    `Verify output (head): ${rerunOutputHead}`,
    '',
    'Judge whether the work satisfies its acceptance criteria. Respond with',
    'ONLY a JSON object: {"verdict": "CONFIRMED"|"CONTRADICTED"|"UNVERIFIABLE",',
    '"score": 1-10, "reasoning": "<two sentences naming specific evidence>"}',
  ].join('\n');
}

export interface ParsedVerdict {
  readonly verdict: ReviewVerdictKind;
  readonly score: number;
  readonly reasoning: string;
}

const VERDICTS: readonly ReviewVerdictKind[] = [
  'CONFIRMED',
  'CONTRADICTED',
  'UNVERIFIABLE',
];

/** Every balanced `{...}` in the text, outermost first, in order of appearance. */
function jsonObjectCandidates(text: string): string[] {
  const out: string[] = [];
  for (
    let start = text.indexOf('{');
    start !== -1;
    start = text.indexOf('{', start + 1)
  ) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        out.push(text.slice(start, i + 1));
        break;
      }
    }
  }
  return out;
}

/**
 * W23-49: the reply, parsed — or refused with a reason that names what was
 * missing. "unparseable verdict" alone told nobody whether the model wrote
 * prose, wrapped the JSON in its thinking, said "confirmed" in lower case or
 * scored "8/10"; each points at a different fix.
 *
 * Tolerated, because they are the same answer: a `<think>` block before the
 * JSON, a fenced block, a lower-case verdict, a score given as a numeric
 * string. NOT tolerated: a score outside 1-10, a verdict outside the three
 * words, or no JSON at all — those are not answers to the question asked.
 * The LAST valid object wins, since a reasoning model restates its answer at
 * the end. A refusal never reads as an approval: `parsed` is null.
 */
export function diagnoseVerdict(raw: string): {
  readonly parsed: ParsedVerdict | null;
  readonly reason: string;
} {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  const candidates = jsonObjectCandidates(text);
  if (candidates.length === 0) {
    return { parsed: null, reason: 'the reply contains no JSON object' };
  }
  let reason = 'no JSON object in the reply parsed';
  for (const candidate of [...candidates].reverse()) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!('verdict' in obj)) {
      reason = 'the JSON has no "verdict" field';
      continue;
    }
    const verdict =
      typeof obj.verdict === 'string' ? obj.verdict.trim().toUpperCase() : '';
    if (!VERDICTS.includes(verdict as ReviewVerdictKind)) {
      reason = `"verdict" is ${JSON.stringify(obj.verdict)}, not one of ${VERDICTS.join('|')}`;
      continue;
    }
    const rawScore = obj.score;
    const score =
      typeof rawScore === 'number'
        ? rawScore
        : typeof rawScore === 'string' && /^\s*\d+\s*$/.test(rawScore)
          ? Number(rawScore)
          : NaN;
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      reason = `"score" is ${JSON.stringify(rawScore ?? null)}, not an integer 1-10`;
      continue;
    }
    return {
      parsed: {
        verdict: verdict as ReviewVerdictKind,
        score,
        reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
      },
      reason: '',
    };
  }
  return { parsed: null, reason };
}

/** How much of a refused reply the log keeps: enough to read, bounded. */
export const RAW_VERDICT_MAX_CHARS = 2000;

function boundRaw(raw: string): string {
  if (raw.length <= RAW_VERDICT_MAX_CHARS) return raw;
  const half = RAW_VERDICT_MAX_CHARS / 2;
  return `${raw.slice(0, half)}\n…[${raw.length - RAW_VERDICT_MAX_CHARS} chars omitted]…\n${raw.slice(-half)}`;
}

/**
 * Ask, parse, and bounce once (R-B2: INCOMPLETE is bounced, not counted).
 * W23-49: every bounce records WHAT the reviewer said — bounded here, and
 * redacted by `record`'s own secret scrub (appendEvent) — and why it was
 * refused, so the cause is read from the log rather than guessed.
 */
export async function askForVerdict(
  chat: (prompt: string) => Promise<string>,
  prompt: string,
  record: (payload: Record<string, unknown>, eventType: string) => unknown,
): Promise<
  | { readonly kind: 'parsed'; readonly parsed: ParsedVerdict }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'bounced' }
> {
  let raw: string;
  try {
    raw = await chat(prompt);
  } catch (err) {
    return {
      kind: 'unavailable',
      reason: `reviewer unavailable: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
    };
  }
  const first = diagnoseVerdict(raw);
  if (first.parsed) return { kind: 'parsed', parsed: first.parsed };
  record(
    {
      attempt: 1,
      reason: 'unparseable verdict',
      detail: first.reason,
      raw: boundRaw(raw),
    },
    'review.bounced',
  );
  let second: ReturnType<typeof diagnoseVerdict>;
  let secondRaw = '';
  try {
    secondRaw = await chat(prompt);
    second = diagnoseVerdict(secondRaw);
  } catch (err) {
    second = {
      parsed: null,
      reason: `the reviewer call failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
    };
  }
  if (second.parsed) return { kind: 'parsed', parsed: second.parsed };
  record(
    {
      attempt: 2,
      reason: 'unparseable verdict — not counted',
      detail: second.reason,
      raw: boundRaw(secondRaw),
    },
    'review.bounced',
  );
  return { kind: 'bounced' };
}
