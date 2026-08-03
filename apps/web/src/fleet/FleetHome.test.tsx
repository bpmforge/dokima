// @vitest-environment jsdom
/**
 * W10-33 red fixtures: a rendered `<button>` with no wired callback passes
 * every test that only checks it exists — these assert the empty-state
 * controls actually invoke their handlers.
 *
 * - DEAD CONTROL 2: previously `EmptyState` stayed mounted underneath an
 *   already-open `NewProjectForm`, so its own "New Product" button called
 *   `setFormMode('new')` while the mode was already `'new'` — a no-op
 *   click. The fix stops rendering the redundant empty-state block once a
 *   form is open; this guards that it's actually gone, not just visually
 *   behind the form.
 * - WITHHELD ACTION 1: UX_SPEC.md:48 requires a link to the guided sample
 *   in the "no programs yet" empty state — it didn't exist at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FleetHome } from './FleetHome.js';
import * as api from './api.js';

vi.mock('./api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.js')>();
  return {
    ...actual,
    fetchProjects: vi.fn(),
    createProject: vi.fn(),
    archiveProject: vi.fn(),
    removeProject: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.fetchProjects.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('FleetHome empty state (W10-33)', () => {
  it('opening the New Product form removes the redundant empty-state block instead of leaving a dead duplicate button', async () => {
    render(<FleetHome onOpenProject={vi.fn()} onOpenWizard={vi.fn()} />);

    const emptyState = await screen.findByTestId('fleet-empty');
    // Before the fix, this same button also renders (dead) inside `emptyState`.
    const emptyStateNewProduct = within(emptyState).getByRole('button', {
      name: 'New Product',
    });
    const header = document.querySelector('.fleet__header') as HTMLElement;
    const headerNewProduct = within(header).getByRole('button', { name: 'New Product' });

    fireEvent.click(headerNewProduct);

    expect(screen.getByRole('form', { name: 'New Product' })).toBeTruthy();
    expect(screen.queryByTestId('fleet-empty')).toBeNull();
    expect(emptyStateNewProduct.isConnected).toBe(false);
  });

  it('the guided-sample link in the empty state invokes onOpenWizard (UX_SPEC.md:48)', async () => {
    const onOpenWizard = vi.fn();
    render(<FleetHome onOpenProject={vi.fn()} onOpenWizard={onOpenWizard} />);

    const guidedSample = await screen.findByRole('button', {
      name: 'Try the guided sample',
    });
    fireEvent.click(guidedSample);

    expect(onOpenWizard).toHaveBeenCalledTimes(1);
  });

  it('re-clicking the header button for the already-open form closes it instead of no-oping', async () => {
    render(<FleetHome onOpenProject={vi.fn()} onOpenWizard={vi.fn()} />);

    await screen.findByTestId('fleet-empty');
    const header = document.querySelector('.fleet__header') as HTMLElement;
    const headerNewProduct = within(header).getByRole('button', { name: 'New Product' });

    fireEvent.click(headerNewProduct);
    expect(screen.getByRole('form', { name: 'New Product' })).toBeTruthy();

    fireEvent.click(headerNewProduct);
    expect(screen.queryByRole('form', { name: 'New Product' })).toBeNull();
    expect(screen.getByTestId('fleet-empty')).toBeTruthy();
  });
});
