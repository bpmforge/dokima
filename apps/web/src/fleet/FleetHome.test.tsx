// @vitest-environment jsdom
/**
 * W10-33: the Fleet empty state has a dead control (its own "New project"
 * button still calls `setFormMode('new')` once the mode is already 'new',
 * a no-op that only manifests once the redundant empty state renders
 * alongside the open form) and a withheld action (UX_SPEC §2b requires a
 * link to the guided sample; only New project/Onboard were offered).
 * Mocks `./api.js` so the component is exercised without a real server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import * as fleetApi from './api.js';
import { FleetHome } from './FleetHome.js';

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return {
    ...actual,
    fetchProjects: vi.fn(),
    createProject: vi.fn(),
    archiveProject: vi.fn(),
    removeProject: vi.fn(),
  };
});

const mockedApi = vi.mocked(fleetApi);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderEmptyFleet(onOpenGuidedSample = vi.fn()) {
  mockedApi.fetchProjects.mockResolvedValue([]);
  const utils = render(
    <FleetHome onOpenProject={vi.fn()} onOpenGuidedSample={onOpenGuidedSample} />,
  );
  await waitFor(() => expect(screen.getByTestId('fleet-empty')).toBeTruthy());
  return { ...utils, onOpenGuidedSample };
}

describe('Fleet empty state guided-sample link (UX_SPEC §2b, FR-C6)', () => {
  it('invokes onOpenGuidedSample when the guided-sample action is clicked', async () => {
    const { onOpenGuidedSample } = await renderEmptyFleet();
    const empty = screen.getByTestId('fleet-empty');

    fireEvent.click(within(empty).getByRole('button', { name: 'Try the guided sample' }));

    expect(onOpenGuidedSample).toHaveBeenCalledTimes(1);
  });
});

describe('Fleet empty state "New project" dead-click (W10-33)', () => {
  it('stops rendering the redundant empty-state actions once the New project form is open, so there is no dead-mode-already-set button left to click', async () => {
    const { container } = await renderEmptyFleet();

    // The bug: this exact button, while formMode is already 'new', calls
    // setFormMode('new') again and does nothing. Click the *header's*
    // instance (the real entry point) to open the form the honest way.
    const header = container.querySelector<HTMLElement>('.fleet__header');
    if (!header) throw new Error('fleet__header not found');
    fireEvent.click(within(header).getByRole('button', { name: 'New project' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'New project' })).toBeTruthy(),
    );
    // The empty state (and its now-inert "New project" control) must be gone —
    // otherwise it sits there as a second, dead "New project" button.
    expect(screen.queryByTestId('fleet-empty')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'New project' })).toHaveLength(1);
  });
});

describe('visual hierarchy (W12-29)', () => {
  it(
    'RED FIXTURE: exactly ONE primary action on the screen. A captured Fleet frame ' +
      'showed six identical outlined pills — nothing primary, nothing receding — so ' +
      'a new user had nowhere to land and read every control left-to-right',
    async () => {
      await renderEmptyFleet();
      // Document-wide, which is the stronger claim: the captured frame caught
      // TWO New project buttons at different weights when this only checked
      // the header.
      const primaries = document.querySelectorAll('.btn-primary');
      expect(primaries.length).toBe(1);
      expect((primaries[0] as HTMLElement).textContent).toContain('New project');
    },
  );

  it('the empty state says what the product is FOR before offering buttons', async () => {
    await renderEmptyFleet();
    const empty = screen.getByTestId('fleet-empty');
    expect(empty.textContent).toMatch(/Describe what you want built/);
    // One primary here too — the ranked choice, not four equals.
    expect(empty.querySelectorAll('.btn-primary').length).toBe(0);
    expect(empty.querySelectorAll('.btn-quiet').length).toBeGreaterThan(0);
  });
});
