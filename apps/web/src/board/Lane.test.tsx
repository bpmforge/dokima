// @vitest-environment jsdom
/**
 * W9-05: six fixed-width status columns routinely overflow the Board
 * pane's width (observed defect: a header rendering as "In Pro…" with
 * no hint there's more). Silent truncation is dishonest (C-1) — the
 * fix must make the hidden columns discoverable, not hide the overflow.
 * This guards both halves of that contract: the scroll strip's
 * accessible affordance (role/aria-label/tabIndex, unchanged by this
 * ticket) and the CSS edge-fade affordance added to board.css. A styled
 * scrollbar alone was verified NOT sufficient — Playwright (and macOS'
 * default overlay-scrollbar setting) suppress it even when overflow-x
 * is auto, so the fade gradient is the affordance that must actually be
 * present in the stylesheet.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Lane } from './Lane.js';
import { BOARD_COLUMNS } from './transitions.js';
import type { BoardLane } from './lanes.js';

afterEach(() => {
  cleanup();
});

const LANE: BoardLane = {
  lane: 'ui',
  columns: BOARD_COLUMNS.map((status) => ({ status, tickets: [] })),
};

describe('Lane horizontal overflow affordance (W9-05)', () => {
  it('marks the columns strip as a scrollable region and renders every column inside it', () => {
    render(
      <Lane lane={LANE} heartbeats={new Map()} onDrop={vi.fn()} onFireVerb={vi.fn()} />,
    );

    const strip = screen.getByRole('group', { name: /scrollable/i });
    expect(strip.className).toContain('board-lane__columns');
    expect(strip.tabIndex).toBe(0);
    // All six fixed lifecycle columns render inside the one scrollable
    // strip — nothing is dropped or paginated away, just possibly offscreen.
    expect(strip.querySelectorAll('.board-column')).toHaveLength(BOARD_COLUMNS.length);
  });

  it('gives the strip a CSS edge-fade affordance that renders independent of native scrollbar visibility', () => {
    // Not `new URL('./board.css', import.meta.url)` — Vite statically
    // detects and rewrites that exact pattern as an asset reference, which
    // breaks fileURLToPath outside a real browser build.
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(path.join(testDir, 'board.css'), 'utf-8');
    const stripBlock = css.slice(
      css.indexOf('.board-lane__columns'),
      css.indexOf('.board-lane__columns::-webkit-scrollbar-thumb'),
    );

    expect(stripBlock).toMatch(/overflow-x:\s*auto/);
    // The scroll-shadow technique: a `local`-attached cover gradient
    // scrolls with the content and un-masks a `scroll`-attached shadow
    // gradient at whichever edge still has hidden columns.
    expect(stripBlock).toMatch(
      /background-attachment:\s*local,\s*local,\s*scroll,\s*scroll/,
    );
    expect(stripBlock).toContain('background-image');
  });
});
