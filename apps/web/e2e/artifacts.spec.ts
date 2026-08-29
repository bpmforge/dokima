import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { freshProjectPath as newTempProject } from './temp-project.js';

/** FR-C3/C5/C8, UX_SPEC §5: artifact viewer + receipt inspector, through the real apps/server. */

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

/** This suite's label bound to the shared helper (W22-15) — the uniform
 * `dokima-<label>-e2e-<uuid>` name is what global-teardown removes. */
function freshProjectPath(label: string): { dir: string; name: string } {
  return newTempProject(`artifacts-${label}`);
}

async function initGitRepoWithDoc(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
  await git(dir, ['init', '-q']);
  await git(dir, ['config', 'user.email', 'e2e@example.com']);
  await git(dir, ['config', 'user.name', 'E2E']);
  await git(dir, ['checkout', '-q', '-b', 'main']);
  await fs.writeFile(
    path.join(dir, 'docs', 'SRS.md'),
    [
      '# Software Requirements',
      '',
      'v1 of the requirements.',
      '',
      '```mermaid',
      'flowchart TB',
      '  A[Idea] --> B[Design]',
      '```',
      '',
    ].join('\n'),
    'utf8',
  );
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-q', '-m', 'v1']);
}

async function openProjectWorkspace(
  page: import('@playwright/test').Page,
  dir: string,
  name: string,
): Promise<void> {
  await page.goto('/');
  const header = page.locator('.fleet__header');
  await header
    .getByRole('button', { name: 'Onboard existing repo', exact: true })
    .click();
  await page.getByLabel('Directory path').fill(dir);
  await page.getByLabel('Name (optional)').fill(name);
  await page
    .locator('.fleet__form')
    .getByRole('button', { name: 'Onboard existing repo' })
    .click();
  // W17-09: creating a project auto-opens it — the workspace, not the grid.
  await expect(page.getByTestId('split-pane-workspace')).toBeVisible();
}

test('artifact viewer shows the empty state before any docs exist (UX_SPEC §2b)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath('empty');
  await fs.mkdir(dir, { recursive: true });
  await openProjectWorkspace(page, dir, name);

  const artifactsPane = page.getByTestId('pane-artifacts');
  await expect(artifactsPane.getByTestId('artifact-viewer')).toBeVisible();
  await expect(
    artifactsPane.getByText('Deliverables appear as phases produce them.'),
  ).toBeVisible();
});

test('receipts tab shows the empty state before any gate has run (UX_SPEC §2b)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath('no-gates');
  await fs.mkdir(dir, { recursive: true });
  await openProjectWorkspace(page, dir, name);

  const artifactsPane = page.getByTestId('pane-artifacts');
  await artifactsPane.getByRole('button', { name: 'Receipts' }).click();
  await expect(artifactsPane.getByText('No gates have run yet.')).toBeVisible();
});

test('renders a committed markdown doc incl. a mermaid diagram, and accepts a comment (FR-C3/C8)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath('doc');
  await initGitRepoWithDoc(dir);
  await openProjectWorkspace(page, dir, name);

  const artifactsPane = page.getByTestId('pane-artifacts');
  await artifactsPane.getByRole('button', { name: 'Software Requirements' }).click();

  await expect(
    artifactsPane.getByRole('heading', { name: 'Software Requirements' }),
  ).toBeVisible();
  await expect(artifactsPane.getByText('v1 of the requirements.')).toBeVisible();
  await expect(
    artifactsPane.getByTestId('markdown-mermaid').locator('svg'),
  ).toBeVisible();
  await expect(artifactsPane.getByTestId('mermaid-node-A')).toBeVisible();
  await expect(artifactsPane.getByTestId('mermaid-node-B')).toBeVisible();

  await artifactsPane
    .getByLabel('New comment')
    .fill('Please clarify the mermaid diagram.');
  await artifactsPane.getByRole('button', { name: 'Comment' }).click();
  await expect(
    artifactsPane.getByText('Please clarify the mermaid diagram.'),
  ).toBeVisible();
});

test('renders a per-ticket branch-vs-base diff (FR-C3)', async ({ page }) => {
  const { dir, name } = freshProjectPath('diff');
  await initGitRepoWithDoc(dir);
  await git(dir, ['checkout', '-q', '-b', 'sw/w4-05-e2e']);
  await fs.writeFile(
    path.join(dir, 'docs', 'SRS.md'),
    ['# Software Requirements', '', 'v2 — revised after review.', ''].join('\n'),
    'utf8',
  );
  await git(dir, ['commit', '-q', '-am', 'v2']);

  await openProjectWorkspace(page, dir, name);
  const artifactsPane = page.getByTestId('pane-artifacts');
  await artifactsPane.getByRole('button', { name: 'Software Requirements' }).click();

  await artifactsPane.getByLabel('Ticket id for live diff').fill('W4-05');
  await artifactsPane.getByRole('button', { name: 'Diff vs base' }).click();

  const diffView = artifactsPane.getByTestId('diff-view');
  await expect(diffView).toBeVisible();
  await expect(diffView.getByText('v1 of the requirements.')).toBeVisible();
  await expect(diffView.getByText('v2 — revised after review.')).toBeVisible();
});

test('a comment resolves by reference once the deliverable is revised, and shows the diff since it (FR-C8)', async ({
  page,
}) => {
  const { dir, name } = freshProjectPath('resolve');
  await initGitRepoWithDoc(dir);
  await openProjectWorkspace(page, dir, name);

  const artifactsPane = page.getByTestId('pane-artifacts');
  await artifactsPane.getByRole('button', { name: 'Software Requirements' }).click();

  await artifactsPane.getByLabel('New comment').fill('Please clarify section 2.');
  await artifactsPane.getByRole('button', { name: 'Comment' }).click();
  await expect(artifactsPane.getByText('Please clarify section 2.')).toBeVisible();
  await expect(
    artifactsPane.getByRole('button', { name: 'View diff since this comment' }),
  ).toHaveCount(0);

  await fs.writeFile(
    path.join(dir, 'docs', 'SRS.md'),
    ['# Software Requirements', '', 'v2 — clarified per feedback.', ''].join('\n'),
    'utf8',
  );
  await git(dir, ['commit', '-q', '-am', 'v2']);

  await expect(artifactsPane.getByText(/Resolved via [0-9a-f]{7,40}/)).toBeVisible({
    timeout: 10_000,
  });
  await artifactsPane
    .getByRole('button', { name: 'View diff since this comment' })
    .click();

  const diffView = artifactsPane.getByTestId('diff-view');
  await expect(diffView).toBeVisible();
  await expect(diffView.getByText('v1 of the requirements.')).toBeVisible();
  await expect(diffView.getByText('v2 — clarified per feedback.')).toBeVisible();
});
