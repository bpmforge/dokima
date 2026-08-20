// @vitest-environment jsdom
/**
 * W13-49. The roster was the audit's worst screen (UX_AUDIT A-1): internal
 * model-prompt text plus three failure-toned diagnostic lines on every card
 * of a HEALTHY install. These tests pin the end-user contract: internal text
 * never renders, and a status line appears only when it informs or asks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as api from './api.js';
import { RosterView, userFacingSummary } from './RosterView.js';
import type { RosterExpert } from './types.js';

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return { ...actual, fetchRoster: vi.fn(), fetchAgentHistory: vi.fn() };
});

afterEach(() => cleanup());

/** Verbatim from the shipped experts library — the text the audit saw rendered. */
const INTERNAL_BRIEF =
  'AI slop detection specialist — checks all 31 ANTI_SLOP_RULES (R-01 to R-31) ' +
  'including 2025-2026 additions: slopsquatting (hallucinated packages), ' +
  'architectural privilege escalation (+322% in AI codebases), credential leakage.';

function expert(overrides: Partial<RosterExpert> = {}): RosterExpert {
  return {
    id: 'anti-slop-auditor',
    displayName: 'Anti-Slop Auditor',
    cluster: 'code-review',
    mode: 'subagent',
    description: INTERNAL_BRIEF,
    effectiveModel: { chain: ['qwen/qwen3-coder-next'], scope: 'global', usedDefaultRole: true },
    fitnessCards: [],
    instructionCost: null,
    ...overrides,
  };
}

describe('userFacingSummary', () => {
  it('takes the clause before the first em-dash — the internal brief never renders', () => {
    expect(userFacingSummary(INTERNAL_BRIEF)).toBe('AI slop detection specialist');
  });

  it('falls back to the first sentence, capped', () => {
    expect(userFacingSummary('Reviews finished work. Then argues about it.')).toBe(
      'Reviews finished work',
    );
    expect(userFacingSummary('x'.repeat(200)).length).toBeLessThanOrEqual(140);
  });
});

describe('RosterView — an end-user surface, not a debug dump (W13-49)', () => {
  it('RED FIXTURE: a healthy expert renders no internal text and no failure-toned diagnostics', async () => {
    vi.mocked(api.fetchRoster).mockResolvedValue([expert()]);
    const { container } = render(<RosterView />);
    await screen.findByText('Anti-Slop Auditor');

    const text = container.textContent ?? '';
    expect(text).not.toContain('ANTI_SLOP');
    expect(text).not.toContain('routing matrix');
    expect(text).not.toContain('not benched');
    expect(text).not.toContain('instruction cost: —');
    // The norm is silence: a globally-resolved model gets no scope chip.
    expect(screen.queryByTestId('roster-expert-scope-anti-slop-auditor')).toBeNull();
    // The model itself IS shown — that part informs.
    expect(text).toContain('qwen/qwen3-coder-next');
  });

  it('a role with no model gets an ACTION, not a diagnosis', async () => {
    vi.mocked(api.fetchRoster).mockResolvedValue([expert({ effectiveModel: { chain: [], scope: null, usedDefaultRole: false } })]);
    render(<RosterView />);
    await screen.findByText('Anti-Slop Auditor');

    expect(
      screen.getByText('No model will take this role yet — pick models in Settings → Models.'),
    ).toBeTruthy();
    expect(screen.getByTestId('roster-expert-scope-anti-slop-auditor').textContent).toBe(
      'needs a model',
    );
  });

  it('fitness and instruction cost render only when they carry a value', async () => {
    vi.mocked(api.fetchRoster).mockResolvedValue([
      expert({
        fitnessCards: [
          { model: 'qwen/qwen3-coder-next', verdict: 'fit', harnessVersion: '1', runAt: 'now' },
        ],
        instructionCost: 412,
      }),
    ]);
    const { container } = render(<RosterView />);
    await screen.findByText('Anti-Slop Auditor');

    const text = container.textContent ?? '';
    expect(text).toContain('qwen/qwen3-coder-next: fit');
    expect(text).toContain('instruction cost: 412');
  });
});
