// @vitest-environment jsdom
/**
 * W13-26. The panel offered a choice that did nothing.
 *
 * Mocks `./api.js` so the component is exercised without a real server — same
 * technique as `fleet/FleetHome.test.tsx` (law 9: never a live call).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as settingsApi from './api.js';
import { AutonomyBudgetPanel } from './AutonomyBudgetPanel.js';

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return {
    ...actual,
    fetchAutonomy: vi.fn(),
    fetchBudget: vi.fn(),
    fetchProjectSettings: vi.fn(),
    putAutonomy: vi.fn(),
    putBudget: vi.fn(),
    putProjectSettings: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function stub(mode: 'interactive' | 'auto'): void {
  vi.mocked(settingsApi.fetchAutonomy).mockResolvedValue({ mode, neverAuto: [] } as never);
  vi.mocked(settingsApi.fetchBudget).mockResolvedValue({
    runLimitUsd: null,
    projectLimitUsd: null,
    // Required: the budget section reads these during render, and omitting
    // them throws before a single label exists to assert on.
    breakerThresholds: { warn: 70, downshift: 85, hardStop: 100 },
  } as never);
  vi.mocked(settingsApi.fetchProjectSettings).mockResolvedValue({ berths: 1 } as never);
}

describe('the autonomy dial says what it actually does (W13-26)', () => {
  it(
    'RED FIXTURE: Auto does not claim to work. It read "documented defaults ' +
      'taken and ledgered" while NO run path read the mode at all — a gated ' +
      'pause opens a clarification that blocks in either mode. A stored ' +
      'setting that changes nothing is worse than an absent one, because the ' +
      'user believes they chose',
    async () => {
      stub('interactive');
      render(<AutonomyBudgetPanel projectId="p1" />);

      const auto = (await screen.findByLabelText(/^Auto — /)) as HTMLInputElement;
      expect(auto.disabled).toBe(true);
      const label = auto.closest('label')?.textContent ?? '';
      expect(label).toContain('not in effect yet');
      expect(label).not.toContain('defaults taken');
    },
  );

  it('and says so once in plain words, not only in a label', async () => {
    stub('interactive');
    render(<AutonomyBudgetPanel projectId="p1" />);
    expect(
      await screen.findByText(/Unattended defaults are not enforced yet/),
    ).toBeTruthy();
  });

  it(
    'but a project that already chose Auto still sees its own state — hiding a ' +
      'stored choice would be a second untruth',
    async () => {
      stub('auto');
      render(<AutonomyBudgetPanel projectId="p1" />);

      const auto = (await screen.findByLabelText(/^Auto — /)) as HTMLInputElement;
      expect(auto.checked).toBe(true);
      expect(auto.disabled).toBe(false);
    },
  );

  it('Interactive stays selectable and is what actually happens', async () => {
    stub('interactive');
    render(<AutonomyBudgetPanel projectId="p1" />);
    const interactive = (await screen.findByLabelText(/^Interactive — /)) as HTMLInputElement;
    expect(interactive.checked).toBe(true);
    expect(interactive.disabled).toBe(false);
  });
});
