// @vitest-environment jsdom
/**
 * W21-95. "Onboard existing repo" registered the folder and never read the
 * code, and the workspace it produced was byte-identical to the one you get
 * from New project on an empty folder — including a board that said it "fills
 * once you describe your idea". For someone who had just pointed at fifty
 * thousand lines, that sentence was false about their own situation.
 *
 * These pin the corrected contract: the empty board names BOTH ways it can be
 * filled, and the analysis it offers is the one the product already has.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EmptyState } from './BoardEmptyState.js';

afterEach(() => cleanup());

describe('the board empty state offers both ways to fill it (W21-95)', () => {
  it('RED FIXTURE: it no longer says an idea is the only way in', async () => {
    render(<EmptyState onViewCurrentPhase={() => undefined} onAnalyseRepository={async () => undefined} />);
    const panel = await screen.findByTestId('board-empty');
    // A3: the false half of the old sentence.
    expect(panel.textContent).not.toContain('fills once you describe your idea');
    // Both routes are present, and the repo one names what it will read.
    expect(screen.getByRole('button', { name: /describe your product/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /analyse this repository/i })).toBeTruthy();
  });

  it('A1: it says plainly that the code has not been read yet', async () => {
    render(<EmptyState onViewCurrentPhase={() => undefined} onAnalyseRepository={async () => undefined} />);
    const panel = await screen.findByTestId('board-empty');
    expect(panel.textContent).toContain('has not read');
  });

  it('A4: a refusal is shown in the product\'s own words, not swallowed', async () => {
    const onAnalyse = vi.fn(async () => 'no model is configured for the analysis role');
    render(<EmptyState onViewCurrentPhase={() => undefined} onAnalyseRepository={onAnalyse} />);
    screen.getByRole('button', { name: /analyse this repository/i }).click();
    const refusal = await screen.findByTestId('board-empty-analysis-refused');
    expect(refusal.textContent).toContain('no model is configured');
    // It must not read as a success that produced nothing.
    expect(refusal.textContent).not.toContain('Analysing');
  });

  it('the offer disappears while it runs, so it cannot be fired twice', async () => {
    let release: (v: undefined) => void = () => undefined;
    const onAnalyse = vi.fn(() => new Promise<undefined>((r) => { release = r; }));
    render(<EmptyState onViewCurrentPhase={() => undefined} onAnalyseRepository={onAnalyse} />);
    screen.getByRole('button', { name: /analyse this repository/i }).click();
    expect(await screen.findByTestId('board-empty-analysing')).toBeTruthy();
    release(undefined);
  });

  it('with no analysis handler the panel is unchanged apart from its copy', async () => {
    render(<EmptyState onViewCurrentPhase={() => undefined} />);
    await screen.findByTestId('board-empty');
    expect(screen.queryByRole('button', { name: /analyse this repository/i })).toBeNull();
    expect(screen.getByRole('button', { name: /describe your product/i })).toBeTruthy();
  });
});
