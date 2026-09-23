/**
 * W23-49 — a reviewer reply the parser refuses says WHY, and what it said.
 *
 * Red fixtures are the shapes local reviewers actually produce: a reasoning
 * model's `<think>` block full of braces before its JSON, a lower-case
 * verdict, a score given as a string. The 2026-09-22 Vault bounce recorded
 * none of this — only "unparseable verdict", twice.
 */

import { describe, expect, it } from 'vitest';
import {
  askForVerdict,
  diagnoseVerdict,
  RAW_VERDICT_MAX_CHARS,
} from './loop-review-prompt.js';

describe('diagnoseVerdict', () => {
  it('RED: a <think> block with braces before the answer no longer hides the answer', () => {
    const raw =
      '<think>The spec checks {a: 1} and the map {x} — fine.</think>\n' +
      '{"verdict": "CONFIRMED", "score": 8, "reasoning": "spec passes."}';
    expect(diagnoseVerdict(raw).parsed).toEqual({
      verdict: 'CONFIRMED',
      score: 8,
      reasoning: 'spec passes.',
    });
  });

  it('RED: a lower-case verdict and a numeric-string score are the same answer', () => {
    const raw = '```json\n{"verdict":"contradicted","score":"3","reasoning":"r"}\n```';
    expect(diagnoseVerdict(raw).parsed).toMatchObject({
      verdict: 'CONTRADICTED',
      score: 3,
    });
  });

  it('the LAST valid object wins — a reasoning model restates its answer at the end', () => {
    const raw =
      'Draft: {"verdict":"UNVERIFIABLE","score":5}. Final: {"verdict":"CONFIRMED","score":9}';
    expect(diagnoseVerdict(raw).parsed).toMatchObject({ verdict: 'CONFIRMED', score: 9 });
  });

  it.each([
    ['I feel good about this one!', /no JSON object/],
    ['{"score": 8}', /no "verdict" field/],
    [
      '{"verdict":"LGTM","score":8}',
      /"LGTM", not one of CONFIRMED\|CONTRADICTED\|UNVERIFIABLE/,
    ],
    ['{"verdict":"CONFIRMED","score":"8/10"}', /"8\/10", not an integer 1-10/],
    ['{"verdict":"CONFIRMED","score":11}', /11, not an integer 1-10/],
    ['{"verdict":"CONFIRMED"}', /null, not an integer 1-10/],
    ['{verdict: CONFIRMED}', /no JSON object in the reply parsed/],
  ])('refuses %j and names what was missing', (raw, reason) => {
    const result = diagnoseVerdict(raw);
    expect(result.parsed).toBeNull();
    expect(result.reason).toMatch(reason);
  });
});

describe('askForVerdict records what a refused reviewer said', () => {
  it('RED: each bounce carries the reason and the raw reply, bounded', async () => {
    const recorded: { payload: Record<string, unknown>; type: string }[] = [];
    const long = `${'x'.repeat(5000)} no json here`;
    const replies = ['{"verdict":"LGTM","score":8}', long];
    const result = await askForVerdict(
      async () => replies.shift()!,
      'prompt',
      (payload, type) => recorded.push({ payload, type }),
    );
    expect(result).toEqual({ kind: 'bounced' });
    expect(recorded.map((r) => r.type)).toEqual(['review.bounced', 'review.bounced']);
    expect(recorded[0]!.payload).toMatchObject({
      attempt: 1,
      reason: 'unparseable verdict',
      detail: expect.stringContaining('"LGTM"'),
      raw: '{"verdict":"LGTM","score":8}',
    });
    const raw2 = String(recorded[1]!.payload.raw);
    expect(raw2.length).toBeLessThan(RAW_VERDICT_MAX_CHARS + 100);
    expect(raw2).toContain('chars omitted');
    expect(raw2.endsWith('no json here')).toBe(true);
  });

  it('a second answer that parses is used, and a failed call is unavailable — never an approval', async () => {
    const replies = ['prose', '{"verdict":"CONFIRMED","score":7}'];
    expect(
      await askForVerdict(
        async () => replies.shift()!,
        'p',
        () => undefined,
      ),
    ).toMatchObject({ kind: 'parsed', parsed: { verdict: 'CONFIRMED', score: 7 } });
    expect(
      await askForVerdict(
        async () => {
          throw new Error('ECONNREFUSED');
        },
        'p',
        () => undefined,
      ),
    ).toMatchObject({
      kind: 'unavailable',
      reason: expect.stringContaining('ECONNREFUSED'),
    });
  });
});
