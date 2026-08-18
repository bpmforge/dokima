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

/**
 * W12-41. The founder hit this on the first screen of the first supervised
 * run and could not get past it: "How do you know what folder directory it
 * needs to be in? ... having them try to remember or type in what they need
 * to do." The form was a bare required input labelled "Directory path", with
 * no placeholder, no default and no example — asking for the absolute path of
 * a directory that `registerProject` creates itself.
 */
describe('New project asks for a name, not a path (W12-41)', () => {
  async function openNewProjectForm() {
    const { container } = await renderEmptyFleet();
    const header = container.querySelector<HTMLElement>('.fleet__header');
    if (!header) throw new Error('fleet__header not found');
    fireEvent.click(within(header).getByRole('button', { name: 'New project' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'New project' })).toBeTruthy(),
    );
  }

  it(
    'RED FIXTURE: there is no "Directory path" field at all. The server already ' +
      'runs fs.mkdir + ensureGitRepo for this mode, so the field asked the user ' +
      'to dictate a location for a directory that did not exist yet',
    async () => {
      await openNewProjectForm();
      expect(screen.queryByLabelText('Directory path')).toBeNull();
      expect(screen.getByLabelText('Project name')).toBeTruthy();
    },
  );

  it('submits a NAME and no path, so the server resolves where it goes', async () => {
    mockedApi.createProject.mockResolvedValue({} as never);
    await openNewProjectForm();

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'My App' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(mockedApi.createProject).toHaveBeenCalled());
    const sent = mockedApi.createProject.mock.calls[0]![0];
    expect(sent).toMatchObject({ name: 'My App', mode: 'new' });
    // Absent, not empty-string: '' would read as "the user chose the empty
    // path" rather than "the user did not choose a path".
    expect('path' in sent).toBe(false);
  });

  it(
    'says what will happen, because a folder appearing somewhere unnamed is ' +
      'worse than being asked. And it offers a way out for people who keep ' +
      'everything under ~/Code',
    async () => {
      await openNewProjectForm();
      expect(screen.getByText(/folder is created for you/i)).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'choose the location' }));
      expect(screen.getByLabelText('Folder')).toBeTruthy();
    },
  );

  it(
    'ONBOARD still asks for the path — that directory already exists and its ' +
      'location is information only the user has (the picker is W12-42)',
    async () => {
      const { container } = await renderEmptyFleet();
      const header = container.querySelector<HTMLElement>('.fleet__header');
      if (!header) throw new Error('fleet__header not found');
      fireEvent.click(
        within(header).getByRole('button', { name: 'Onboard existing repo' }),
      );
      await waitFor(() => expect(screen.getByLabelText('Directory path')).toBeTruthy());
      expect(screen.queryByLabelText('Project name')).toBeNull();
    },
  );
});
