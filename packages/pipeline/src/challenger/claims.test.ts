import { describe, expect, it } from 'vitest';
import { evaluateClaimChallenge, DEFAULT_MAX_TOOL_CALLS_PER_CLAIM } from './claims.js';
import { ChallengerSameModelError } from './model-guard.js';
import type { ChallengeAttempt, Claim } from './claims.js';

const claim: Claim = {
  id: 'C-1',
  text: 'the API returns 204 on success',
  originatingRole: 'api-designer',
  artifactPath: 'docs/API_DESIGN.md',
};

function baseAttempt(overrides: Partial<ChallengeAttempt> = {}): ChallengeAttempt {
  return {
    claim,
    rawVerdict: 'CONFIRMED',
    citations: [{ source: 'docs/API_DESIGN.md', locator: 'L42' }],
    toolCallsUsed: 1,
    rerun: { command: 'curl -i /health', counts: { requests: 1 }, exitCode: 0 },
    challengerModel: 'claude-opus',
    makerModel: 'claude-sonnet',
    reasoning: 'checked the OpenAPI spec directly',
    ...overrides,
  };
}

describe('evaluateClaimChallenge (FR-P4/US-405)', () => {
  it('records CONFIRMED with a citation and valid re-run evidence', () => {
    const outcome = evaluateClaimChallenge(baseAttempt());
    expect(outcome.status).toBe('RECORDED');
    if (outcome.status !== 'RECORDED') throw new Error('unreachable');
    expect(outcome.result.verdict).toBe('CONFIRMED');
    expect(outcome.result.downgraded).toBe(false);
    expect(outcome.result.rerunLine).toContain('re-ran independently:');
  });

  it('records CONTRADICTED with a citation', () => {
    const outcome = evaluateClaimChallenge(baseAttempt({ rawVerdict: 'CONTRADICTED' }));
    expect(outcome.status).toBe('RECORDED');
    if (outcome.status !== 'RECORDED') throw new Error('unreachable');
    expect(outcome.result.verdict).toBe('CONTRADICTED');
  });

  it('AC-2: a citation-less CONTRADICTED is downgraded to UNVERIFIABLE, never counted as a contradiction', () => {
    const outcome = evaluateClaimChallenge(
      baseAttempt({ rawVerdict: 'CONTRADICTED', citations: [] }),
    );
    expect(outcome.status).toBe('RECORDED');
    if (outcome.status !== 'RECORDED') throw new Error('unreachable');
    expect(outcome.result.verdict).toBe('UNVERIFIABLE');
    expect(outcome.result.downgraded).toBe(true);
    expect(outcome.result.downgradeReasons.join(' ')).toContain('citation-less');
  });

  it('a citation-less CONFIRMED is also downgraded to UNVERIFIABLE (discarded, not just capped on the contradiction side)', () => {
    const outcome = evaluateClaimChallenge(
      baseAttempt({ rawVerdict: 'CONFIRMED', citations: [] }),
    );
    expect(outcome.status).toBe('RECORDED');
    if (outcome.status !== 'RECORDED') throw new Error('unreachable');
    expect(outcome.result.verdict).toBe('UNVERIFIABLE');
  });

  it('a citation-less UNVERIFIABLE stays UNVERIFIABLE without being flagged as downgraded', () => {
    const outcome = evaluateClaimChallenge(
      baseAttempt({ rawVerdict: 'UNVERIFIABLE', citations: [] }),
    );
    expect(outcome.status).toBe('RECORDED');
    if (outcome.status !== 'RECORDED') throw new Error('unreachable');
    expect(outcome.result.verdict).toBe('UNVERIFIABLE');
    expect(outcome.result.downgraded).toBe(false);
  });

  it('tool-call cap: exceeding the cap forces UNVERIFIABLE even with a citation', () => {
    const outcome = evaluateClaimChallenge(
      baseAttempt({
        rawVerdict: 'CONTRADICTED',
        toolCallsUsed: DEFAULT_MAX_TOOL_CALLS_PER_CLAIM + 1,
      }),
    );
    expect(outcome.status).toBe('RECORDED');
    if (outcome.status !== 'RECORDED') throw new Error('unreachable');
    expect(outcome.result.verdict).toBe('UNVERIFIABLE');
    expect(outcome.result.downgradeReasons.join(' ')).toContain('tool-call cap');
  });

  it('tool-call cap respects a custom cap override', () => {
    const outcome = evaluateClaimChallenge(baseAttempt({ toolCallsUsed: 3 }), 2);
    expect(outcome.status).toBe('RECORDED');
    if (outcome.status !== 'RECORDED') throw new Error('unreachable');
    expect(outcome.result.verdict).toBe('UNVERIFIABLE');
  });

  it('a claim within the tool-call cap is unaffected', () => {
    const outcome = evaluateClaimChallenge(
      baseAttempt({ toolCallsUsed: DEFAULT_MAX_TOOL_CALLS_PER_CLAIM }),
    );
    expect(outcome.status).toBe('RECORDED');
    if (outcome.status !== 'RECORDED') throw new Error('unreachable');
    expect(outcome.result.downgraded).toBe(false);
  });

  it('R-B2: missing re-run evidence bounces the claim as INCOMPLETE, never counted', () => {
    const outcome = evaluateClaimChallenge(baseAttempt({ rerun: null }));
    expect(outcome.status).toBe('INCOMPLETE');
    if (outcome.status !== 'INCOMPLETE') throw new Error('unreachable');
    expect(outcome.claimId).toBe('C-1');
    expect(outcome.reason).toContain('re-ran independently');
  });

  it('R-B2: malformed re-run evidence (empty counts) also bounces as INCOMPLETE', () => {
    const outcome = evaluateClaimChallenge(
      baseAttempt({ rerun: { command: 'x', counts: {}, exitCode: 0 } }),
    );
    expect(outcome.status).toBe('INCOMPLETE');
  });

  it('W2-05: refuses when the challenger model equals the maker model', () => {
    expect(() =>
      evaluateClaimChallenge(
        baseAttempt({ challengerModel: 'claude-sonnet', makerModel: 'claude-sonnet' }),
      ),
    ).toThrow(ChallengerSameModelError);
  });

  it('same-model refusal happens before the re-run/citation checks run', () => {
    expect(() =>
      evaluateClaimChallenge(
        baseAttempt({
          challengerModel: 'claude-sonnet',
          makerModel: 'claude-sonnet',
          rerun: null,
          citations: [],
        }),
      ),
    ).toThrow(ChallengerSameModelError);
  });
});
