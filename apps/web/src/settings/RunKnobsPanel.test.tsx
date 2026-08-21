// @vitest-environment jsdom
/**
 * W17-08: the two knobs the live UAT proved matter, promoted from raw
 * key/value settings — the turn budget and the forge mirror.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as settingsApi from './api.js';
import { RunKnobsPanel } from './RunKnobsPanel.js';

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return {
    ...actual,
    fetchProjectSettings: vi.fn().mockResolvedValue({}),
    putProjectSettings: vi.fn().mockResolvedValue({}),
  };
});
const mocked = vi.mocked(settingsApi);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocked.fetchProjectSettings.mockResolvedValue({} as never);
});

describe('RunKnobsPanel (W17-08)', () => {
  it('RED FIXTURE: the turn-budget control writes the exact key the park evidence names, with the ceiling and the why stated', async () => {
    render(<RunKnobsPanel projectId="p1" />);
    const hint = await screen.findByTestId('turn-budget-hint');
    expect(hint.textContent).toContain('hard cap of 40');
    expect(hint.textContent).toContain('chatty local models');

    fireEvent.change(screen.getByTestId('turn-budget-input'), {
      target: { value: '24' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save turn budget' }));
    await waitFor(() =>
      expect(mocked.putProjectSettings).toHaveBeenCalledWith('p1', {
        maxToolIterations: 24,
      }),
    );
  });

  it('the mirror form takes a vault secret NAME (law 8 wording) and writes the forgeMirror shape the run reads', async () => {
    render(<RunKnobsPanel projectId="p1" />);
    const hint = await screen.findByTestId('forge-mirror-hint');
    expect(hint.textContent).toContain('never paste the token itself');

    fireEvent.change(screen.getByLabelText('Gitea URL'), {
      target: { value: 'https://git.example.com' },
    });
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'brad' } });
    fireEvent.change(screen.getByLabelText('Repository'), {
      target: { value: 'recipe-keeper' },
    });
    fireEvent.change(screen.getByTestId('forge-token-ref'), {
      target: { value: 'FORGE_MAKER_TOKEN' },
    });
    fireEvent.change(screen.getByLabelText('Bot account username'), {
      target: { value: 'dokima-bot' },
    });
    fireEvent.click(screen.getByTestId('forge-mirror-save'));
    await waitFor(() =>
      expect(mocked.putProjectSettings).toHaveBeenCalledWith('p1', {
        forgeMirror: {
          kind: 'gitea',
          baseUrl: 'https://git.example.com',
          owner: 'brad',
          repo: 'recipe-keeper',
          makerTokenRef: 'FORGE_MAKER_TOKEN',
          makerLogin: 'dokima-bot',
        },
      }),
    );
  });

  it('an existing mirror loads back and says so', async () => {
    mocked.fetchProjectSettings.mockResolvedValue({
      forgeMirror: {
        kind: 'github',
        owner: 'o',
        repo: 'r',
        makerTokenRef: 'T',
        makerLogin: 'bot',
      },
    } as never);
    render(<RunKnobsPanel projectId="p1" />);
    expect(
      await screen.findByText('A mirror is configured for this project.'),
    ).toBeTruthy();
  });
});

describe('the unset budget shows its default (W18-09)', () => {
  it('an empty turn-budget input names 12 — the value runs actually use', async () => {
    render(<RunKnobsPanel projectId="p1" />);
    const input = (await screen.findByTestId('turn-budget-input')) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toContain('12');
    expect(input.placeholder.toLowerCase()).toContain('default');
  });
});
