// @vitest-environment jsdom
/**
 * W17-08: the fallback-chain editor — until this, fallback[] was
 * render-only and every ladder had exactly one rung (the W16-01 climb had
 * nowhere to go).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as settingsApi from './api.js';
import { ModelMatrixPanel } from './ModelMatrixPanel.js';

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return {
    ...actual,
    fetchModelMatrix: vi.fn(),
    putModelMatrix: vi.fn(),
    benchModel: vi.fn(),
  };
});
const mocked = vi.mocked(settingsApi);

const ROW = {
  role: 'coding-agent',
  taskType: 'reasoning' as const,
  model: 'cheap-local',
  fallback: [] as string[],
  copilotBacked: false,
};
const MATRIX = { scope: 'project' as const, rows: [ROW], copilotEnabled: false };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the fallback-chain editor (W17-08)', () => {
  it('RED FIXTURE: adding a fallback writes the row back with the chain — the saved matrix round-trips fallback[], never drops it', async () => {
    mocked.fetchModelMatrix.mockResolvedValue(MATRIX as never);
    mocked.putModelMatrix.mockResolvedValue({
      ...MATRIX,
      rows: [{ ...ROW, fallback: ['cloud/frontier'] }],
    } as never);

    render(<ModelMatrixPanel projectId="p1" catalogs={{}} providerEntries={[]} />);
    const input = await screen.findByLabelText(
      'Add fallback model for coding-agent (reasoning)',
    );
    fireEvent.change(input, { target: { value: 'cloud/frontier' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add fallback' }));

    await waitFor(() => expect(mocked.putModelMatrix).toHaveBeenCalled());
    const [, rows] = mocked.putModelMatrix.mock.calls[0]!;
    expect(rows).toEqual([
      {
        role: 'coding-agent',
        taskType: 'reasoning',
        model: 'cheap-local',
        fallback: ['cloud/frontier'],
      },
    ]);
    // The saved chain renders back.
    expect(
      (await screen.findByTestId('fallback-coding-agent:reasoning')).textContent,
    ).toContain('cloud/frontier');
  });

  it('the ladder explainer says what a chain means in plain words', async () => {
    mocked.fetchModelMatrix.mockResolvedValue(MATRIX as never);
    render(<ModelMatrixPanel projectId="p1" catalogs={{}} providerEntries={[]} />);
    const explainer = await screen.findByTestId('fallback-explainer');
    expect(explainer.textContent).toContain('escalation ladder');
    expect(explainer.textContent).toContain('cheap model first');
  });
});

describe('the empty model picker points at the real step (W18-06)', () => {
  it('names the untested provider and the Providers tab when one is registered', async () => {
    render(
      <ModelMatrixPanel
        projectId="p1"
        catalogs={{}}
        providerEntries={[{ id: 'lm-studio', kind: 'lmstudio', enabled: true }] as never}
      />,
    );
    expect(
      await screen.findByText(
        'No models discovered yet — test the lm-studio provider on the Providers tab to discover its models',
      ),
    ).toBeTruthy();
  });

  it('points at the Providers tab (not "above") when no provider exists', async () => {
    render(<ModelMatrixPanel projectId="p1" catalogs={{}} providerEntries={[]} />);
    expect(
      await screen.findByText(
        'No models discovered yet — register and test a provider on the Providers tab',
      ),
    ).toBeTruthy();
  });
});

describe('the fitness column earns its place (W19-06)', () => {
  it('RED FIXTURE: "not benched" now carries the Bench action; clicking it runs the bench and the returned verdict fills the cell — no more permanent wall', async () => {
    mocked.fetchModelMatrix.mockResolvedValue(MATRIX as never);
    mocked.benchModel.mockResolvedValue({
      model: 'cheap-local',
      role: 'coding-agent',
      verdict: 'marginal',
      tasks: [{ id: 't1', passed: true }],
    } as never);
    render(<ModelMatrixPanel projectId="p1" catalogs={{}} providerEntries={[]} />);
    const bench = await screen.findByTestId('bench-coding-agent-reasoning');
    expect(bench.title).toContain('records the verdict');
    fireEvent.click(bench);
    const verdict = await screen.findByTestId('bench-verdict-coding-agent-reasoning');
    expect(verdict.textContent).toBe('marginal');
    expect(mocked.benchModel).toHaveBeenCalledWith('p1', 'coding-agent');
  });

  it('a failed bench says so and keeps the action available — never a fabricated verdict (C-1)', async () => {
    mocked.fetchModelMatrix.mockResolvedValue(MATRIX as never);
    mocked.benchModel.mockRejectedValue(new Error('endpoint down'));
    render(<ModelMatrixPanel projectId="p1" catalogs={{}} providerEntries={[]} />);
    fireEvent.click(await screen.findByTestId('bench-coding-agent-reasoning'));
    await waitFor(() => {
      expect(screen.getByText('bench failed')).toBeTruthy();
    });
    expect(screen.getByTestId('bench-coding-agent-reasoning')).toBeTruthy();
  });
});
