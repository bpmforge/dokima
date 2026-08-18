// @vitest-environment jsdom
/**
 * W13-01. Found in a live walkthrough, and proven by accident: driving the
 * browser, a click at the header's coordinates landed in a textarea, because
 * the header had scrolled away. On the Describe form — nine questions, well
 * past one viewport — every navigation control disappears once you scroll.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { AppHeader } from './Header.js';
import { ThemeProvider } from '../theme/ThemeProvider.js';

// jsdom ships no matchMedia, and ThemeProvider reads the OS preference.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }),
  });
});

afterEach(cleanup);

function renderHeader(overrides: Partial<Parameters<typeof AppHeader>[0]> = {}) {
  return render(
    <ThemeProvider>
      <AppHeader
      appName="Dokima"
      view={null}
      projectId="p1"
      decideBadgeCount={0}
      openView={vi.fn()}
      closeView={vi.fn()}
        {...overrides}
      />
    </ThemeProvider>,
  );
}

function destinationNames(): string[] {
  return Array.from(
    within(screen.getByRole('navigation')).getAllByRole('button'),
  ).map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
}

describe('the destination set is stable across views (W13-01)', () => {
  it(
    'RED FIXTURE: opening a view does not delete the other destinations. The ' +
      'whole nav used to collapse to a single "← Back", so the map a user had ' +
      'just learned vanished the moment they acted on it — a large part of why ' +
      'the founder reported stopping every second',
    () => {
      renderHeader({ view: null });
      const atRest = destinationNames();
      cleanup();
      renderHeader({ view: 'interview' });
      expect(destinationNames()).toEqual(atRest);
    },
  );

  it('marks the current view instead of removing it — removal is what disorients', () => {
    renderHeader({ view: 'plans' });
    const current = within(screen.getByRole('navigation'))
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain('Plan');
  });

  it('the workspace is a destination too, so there is always a way back to it', () => {
    renderHeader({ view: 'interview' });
    expect(screen.getByRole('button', { name: 'Board' })).toBeTruthy();
  });

  it('a project-less header offers only what exists — no dead destinations', () => {
    renderHeader({ view: null, projectId: null });
    const names = destinationNames().join(' ');
    expect(names).toContain('Roster');
    expect(names).not.toContain('Describe');
  });

  it(
    'RED FIXTURE: there is ALWAYS a way back to the main surface. The first ' +
      'draft made it project-only, which stranded anyone who opened the Roster ' +
      'with no project — the nav offered Roster, they were on Roster, and ' +
      'nothing led home. Three e2e specs caught it; the label says which ' +
      'surface it currently is',
    () => {
      renderHeader({ view: 'roster', projectId: null });
      expect(screen.getByRole('button', { name: 'Fleet' })).toBeTruthy();
      cleanup();
      renderHeader({ view: 'roster', projectId: 'p1' });
      expect(screen.getByRole('button', { name: 'Board' })).toBeTruthy();
    },
  );

  it(
    'groups by kind, so Describe does not read the same as the theme toggle. ' +
      'Seven controls at identical weight is why the primary action of a new ' +
      'project looked like a preference',
    () => {
      renderHeader({ view: null });
      // Where you can go.
      expect(screen.getByRole('navigation')).toBeTruthy();
      // What you can set — deliberately outside the nav landmark.
      const settings = screen.getByRole('button', { name: 'Settings' });
      expect(within(screen.getByRole('navigation')).queryByText('Settings')).toBeNull();
      expect(settings.className).toContain('btn-quiet');
    },
  );
});

describe('the header stays reachable (W13-01)', () => {
  it(
    'RED FIXTURE: the header is sticky with an opaque ground. Proven by ' +
      'accident in a live walkthrough — a click aimed at the header landed in ' +
      'a textarea, because on the nine-question Describe form the header had ' +
      'scrolled off and there was no way out without scrolling back up',
    async () => {
      const { readFileSync } = await import('node:fs');
      const path = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const css = readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'styles.css'),
        'utf-8',
      );
      const header = css.slice(
        css.indexOf('.app-shell__header {'),
        css.indexOf('}', css.indexOf('.app-shell__header {')),
      );
      expect(header).toMatch(/position:\s*sticky/);
      expect(header).toMatch(/top:\s*0/);
      // Opacity is part of the fix, not decoration: a translucent sticky bar
      // lets the form scroll visibly through it.
      expect(header).toMatch(/background:\s*var\(--sw-bg\)/);
    },
  );
});
