// @vitest-environment jsdom
/**
 * W12-42. The acceptance is behavioural: onboard completes without the user
 * typing a path, and a bad selection is refused BY NAME rather than as a
 * generic failure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as fleetApi from './api.js';
import { DirectoryPicker } from './DirectoryPicker.js';

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return { ...actual, fetchBrowseRoots: vi.fn(), browseDirectory: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function stubTree() {
  vi.mocked(fleetApi.fetchBrowseRoots).mockResolvedValue([
    { path: '/home/u/Code', label: 'Code' },
    { path: '/home/u', label: 'Home' },
  ]);
  vi.mocked(fleetApi.browseDirectory).mockImplementation(async (target: string) => {
    if (target === '/home/u/Code') {
      return {
        path: '/home/u/Code',
        parent: null,
        entries: [
          { name: 'existing-repo', path: '/home/u/Code/existing-repo', registered: false },
          { name: 'already', path: '/home/u/Code/already', registered: true },
        ],
      };
    }
    return { path: target, parent: '/home/u/Code', entries: [] };
  });
}

describe('DirectoryPicker (W12-42)', () => {
  it(
    'RED FIXTURE: a directory can be chosen WITHOUT typing a path. The onboard ' +
      'form asked a person to recall an absolute path exactly, next to a ' +
      'placeholder showing somebody else’s',
    async () => {
      stubTree();
      const onChange = vi.fn();
      render(<DirectoryPicker value="" onChange={onChange} />);

      fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
      await waitFor(() => expect(screen.getByText('existing-repo')).toBeTruthy());

      // "Use this" on the row — no keystrokes anywhere in this test.
      const row = screen.getByText('existing-repo').closest('li');
      fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Use this' }));

      expect(onChange).toHaveBeenCalledWith('/home/u/Code/existing-repo');
    },
  );

  it('opens at real starting points, never at the filesystem root', async () => {
    stubTree();
    render(<DirectoryPicker value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Code' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    // The first root is opened for you: the common case is two clicks, not a
    // walk down from `/`.
    expect(vi.mocked(fleetApi.browseDirectory)).toHaveBeenCalledWith(
      '/home/u/Code',
      expect.anything(),
    );
  });

  it(
    'an already-registered directory is not offered — the server would refuse ' +
      'it after the user committed, which is the wrong moment to find out',
    async () => {
      stubTree();
      render(<DirectoryPicker value="" onChange={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));

      await waitFor(() => expect(screen.getByText('already')).toBeTruthy());
      const row = screen.getByText('already').closest('li') as HTMLElement;
      expect(within(row).queryByRole('button', { name: 'Use this' })).toBeNull();
      expect(within(row).getByText('already open')).toBeTruthy();
    },
  );

  it(
    'REFUSES BY NAME. The server distinguishes missing from unreadable from ' +
      'out-of-bounds, and each is a different thing to do next — collapsing ' +
      'them into "could not open" throws away the only useful part',
    async () => {
      vi.mocked(fleetApi.fetchBrowseRoots).mockResolvedValue([
        { path: '/home/u/Code', label: 'Code' },
      ]);
      vi.mocked(fleetApi.browseDirectory).mockRejectedValue(
        new fleetApi.FleetApiError(409, '/etc is outside the directories Dokima will list.'),
      );

      render(<DirectoryPicker value="" onChange={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('outside the directories');
      });
    },
  );
});
