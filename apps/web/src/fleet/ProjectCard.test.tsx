// @vitest-environment jsdom
/**
 * W13-05. Seen live: six project cards, every one reading
 * "Not started · Ready 0 · Blocked 0 · Done 0 · No berths running · $0.00
 * today". The one project with Ready 1 was visually indistinguishable from
 * five with nothing to do.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ProjectCard } from './ProjectCard.js';
import type { ProjectCard as Data } from './types.js';

afterEach(cleanup);

function card(overrides: Partial<Data> = {}): Data {
  return {
    id: 'p1',
    path: '/tmp/p1',
    name: 'Recipe Box',
    archived: false,
    available: true,
    createdAt: '2026-08-18T00:00:00.000Z',
    lastOpenedAt: '2026-08-18T00:00:00.000Z',
    phase: null,
    board: { ready: 0, blocked: 0, done: 0 },
    berthsRunning: 0,
    heartbeatAgeMs: null,
    pendingDecideCount: 0,
    spendTodayUsd: 0,
    ...overrides,
  } as Data;
}

function renderCard(data: Data) {
  return render(
    <ProjectCard
      card={data}
      archivedView={false}
      onOpen={vi.fn()}
      onArchive={vi.fn()}
      onReopen={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
}

describe('a card that needs you is a different shape (W13-05)', () => {
  it(
    'RED FIXTURE: a project awaiting a decision is distinguishable by FORM, ' +
      'not by the digit. Asserted on the class rather than a screenshot, so it ' +
      'stays true when the visual treatment changes',
    () => {
      const { container } = renderCard(card({ pendingDecideCount: 2 }));
      const article = container.querySelector('article')!;
      expect(article.className).toContain('surface--attention');
    },
  );

  it('an idle project recedes rather than competing — five of six were noise', () => {
    const { container } = renderCard(card());
    const article = container.querySelector('article')!;
    expect(article.className).toContain('surface--idle');
    expect(article.className).not.toContain('surface--attention');
  });

  it(
    'work waiting is not the same as a decision waiting. Ready 1 should not ' +
      'shout for a person, but it must not read as idle either',
    () => {
      const { container } = renderCard(card({ board: { ready: 1, blocked: 0, done: 0 } }));
      const article = container.querySelector('article')!;
      expect(article.className).not.toContain('surface--idle');
      expect(article.className).not.toContain('surface--attention');
    },
  );
});

describe('the numbers read as readings (W13-05)', () => {
  it('every count is a readout, so a column of figures lines up and scans', () => {
    const { container } = renderCard(card({ board: { ready: 3, blocked: 0, done: 7 } }));
    expect(container.querySelectorAll('.readout').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('.readout__value')?.className).toContain(
      'readout__value',
    );
  });

  it('a zero recedes — a reading of nothing is not news', () => {
    const { container } = renderCard(card({ board: { ready: 0, blocked: 0, done: 0 } }));
    const idle = container.querySelectorAll('.readout--idle');
    expect(idle.length).toBe(3);
  });

  it('a non-zero count does NOT recede', () => {
    const { container } = renderCard(card({ board: { ready: 4, blocked: 0, done: 0 } }));
    expect(container.querySelectorAll('.readout--idle').length).toBe(2);
  });
});

describe('the two actions are not equal (W13-05)', () => {
  it(
    'Open is what you do every time; Archive is rare and semi-destructive. ' +
      'They rendered at identical weight',
    () => {
      renderCard(card());
      expect(screen.getByRole('button', { name: 'Open' }).className).toContain(
        'btn-primary',
      );
      expect(screen.getByRole('button', { name: 'Archive' }).className).toContain(
        'btn-quiet',
      );
    },
  );
});

describe('the berths line uses the shared state vocabulary (W13-05)', () => {
  it('a running project reads as running, in the same words a board lane would use', () => {
    const { container } = renderCard(card({ berthsRunning: 2, heartbeatAgeMs: 1000 }));
    expect(container.querySelector('.state--running')).toBeTruthy();
  });

  it('nothing running is idle, not an absence of information', () => {
    const { container } = renderCard(card());
    expect(container.querySelector('.state--idle')).toBeTruthy();
  });
});

describe('the running reading is plain language (W13-62)', () => {
  it("RED FIXTURE: says 'agents running', never the undefined internal word 'berth'", () => {
    const idle = renderCard(card());
    expect(idle.container.textContent).toContain('No agents running');
    expect(idle.container.textContent).not.toMatch(/berth/i);
    cleanup();
    const busy = renderCard(card({ berthsRunning: 2, heartbeatAgeMs: 1000 }));
    expect(busy.container.textContent).toContain('2 agents running');
    expect(busy.container.textContent).not.toMatch(/berth/i);
  });
});
