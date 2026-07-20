// @vitest-environment jsdom
/**
 * Edit/Save/Cancel flow coverage (this ticket's AC2, review-caught gap —
 * previously zero automated coverage of startEdit/saveEdit/cancelEdit).
 * Mocks `./api.js` so the component is exercised without a real server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArtifactViewer } from './ArtifactViewer.js';
import * as api from './api.js';
import type { ArtifactDoc, ArtifactListItem } from './types.js';

vi.mock('./api.js', () => ({
  fetchArtifactList: vi.fn(),
  fetchArtifactDoc: vi.fn(),
  fetchArtifactDiff: vi.fn(),
  fetchArtifactDocDiff: vi.fn(),
  fetchArtifactComments: vi.fn(),
  postArtifactComment: vi.fn(),
  fetchReceipt: vi.fn(),
  fetchReceipts: vi.fn(),
}));

const mockedApi = vi.mocked(api);

const DOC_ITEM: ArtifactListItem = {
  path: 'docs/SRS.md',
  title: 'Software Requirements',
};
const ORIGINAL_CONTENT = 'Original text.';

function makeDoc(content: string): ArtifactDoc {
  return {
    path: 'docs/SRS.md',
    content,
    rev: 'HEAD',
    versions: [{ rev: 'HEAD', author: 'tester', at: '2026-07-19', subject: 'v1' }],
  };
}

async function renderAndSelectDoc() {
  render(<ArtifactViewer projectId="proj-1" token="tok-1" />);
  const docButton = await screen.findByRole('button', { name: 'Software Requirements' });
  fireEvent.click(docButton);
  await screen.findByText(ORIGINAL_CONTENT);
}

function editTextarea(): HTMLTextAreaElement {
  return screen.getByLabelText('Edit deliverable content') as HTMLTextAreaElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.fetchArtifactList.mockResolvedValue([DOC_ITEM]);
  mockedApi.fetchArtifactDoc.mockResolvedValue(makeDoc(ORIGINAL_CONTENT));
  mockedApi.fetchArtifactComments.mockResolvedValue([]);
  mockedApi.fetchReceipts.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('ArtifactViewer edit flow', () => {
  it('entering edit mode seeds the textarea from the current content', async () => {
    await renderAndSelectDoc();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(editTextarea().value).toBe(ORIGINAL_CONTENT);
  });

  it('saving a change calls postArtifactComment with a phase-populated payload and exits edit mode', async () => {
    mockedApi.postArtifactComment.mockResolvedValue({
      comment: {
        seq: 1,
        at: '2026-07-19T00:00:00Z',
        actorId: 'operator',
        body: 'New content revised.',
        versionRef: 'HEAD',
        revisionRequested: false,
      },
      revisionRequested: false,
    });
    await renderAndSelectDoc();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    fireEvent.change(editTextarea(), { target: { value: 'New content revised.' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockedApi.postArtifactComment).toHaveBeenCalledTimes(1));
    expect(mockedApi.postArtifactComment).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({
        path: 'docs/SRS.md',
        body: 'New content revised.',
        versionRef: 'HEAD',
        phase: 2,
      }),
      expect.anything(),
    );

    await waitFor(() =>
      expect(screen.queryByLabelText('Edit deliverable content')).toBeNull(),
    );
    expect(screen.getByText('New content revised.')).toBeTruthy();
  });

  it('cancelling discards the draft, exits edit mode, and never calls postArtifactComment', async () => {
    await renderAndSelectDoc();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    fireEvent.change(editTextarea(), { target: { value: 'Should be discarded.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Edit deliverable content')).toBeNull();
    expect(mockedApi.postArtifactComment).not.toHaveBeenCalled();
    expect(screen.getByText(ORIGINAL_CONTENT)).toBeTruthy();
  });

  it('disables Save while the draft is unchanged or blank, enables it once meaningfully edited', async () => {
    await renderAndSelectDoc();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(saveButton().disabled).toBe(true);

    fireEvent.change(editTextarea(), { target: { value: 'A real change.' } });
    expect(saveButton().disabled).toBe(false);

    fireEvent.change(editTextarea(), { target: { value: '   ' } });
    expect(saveButton().disabled).toBe(true);
  });

  it('shows an error and stays in edit mode when saving fails', async () => {
    mockedApi.postArtifactComment.mockRejectedValue(new Error('network down'));
    await renderAndSelectDoc();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    fireEvent.change(editTextarea(), { target: { value: 'Attempted edit.' } });
    fireEvent.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('network down');
    expect(editTextarea().value).toBe('Attempted edit.');
  });
});
