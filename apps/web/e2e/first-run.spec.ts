import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * W10-56 — what a stranger sees in the first minute of a product they just
 * made. Both cases were measured in a browser on a real new product.
 */

const dirs: string[] = [];

test.afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function newProduct(page: Page): Promise<void> {
  const id = randomUUID();
  const dir = path.join(os.tmpdir(), `dokima-firstrun-${id}`);
  const name = `First Run ${id}`;
  dirs.push(dir);

  await page.goto('/');
  const header = page.locator('.fleet__header');
  await header.getByRole('button', { name: 'New Product', exact: true }).click();
  await page.getByLabel('Directory path').fill(dir);
  await page.getByLabel('Name (optional)').fill(name);
  await page.locator('.fleet__form').getByRole('button', { name: 'New Product' }).click();

  const card = page.locator('.project-card', { hasText: name });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Open' }).click();
}

test('RED FIXTURE: a brand-new product shows no sample cards about Dokima itself', async ({
  page,
}) => {
  await newProduct(page);

  const chatPane = page.getByTestId('pane-chat');
  await expect(chatPane).toBeVisible();

  // ANCHORED ON A POSITIVE SIGNAL FIRST. Asserting absence alone races the
  // async chat fetch — `toHaveCount(0)` is satisfied by a pane that simply has
  // not loaded yet, which is how the first version of this spec passed against
  // the very code it was meant to fail. Waiting for the empty state means the
  // stream really did arrive and really was empty.
  await expect(chatPane.getByTestId('chat-empty-state')).toBeVisible();

  // Measured before this ticket: the pane rendered cards referencing W4-04,
  // FR-C2, apps/web/src/chat/ChatView.tsx and dollar costs — Dokima's own
  // internals, in a stranger's project. The cards were badged SAMPLE and their
  // receipts resolved (W9-03 made that honest, and this does not undo it); the
  // defect was placement, not honesty.
  await expect(chatPane.getByText('W4-04')).toHaveCount(0);
  await expect(chatPane.getByText('FR-C2')).toHaveCount(0);
});

test('RED FIXTURE: the empty-board control goes where a board actually comes from', async ({
  page,
}) => {
  await newProduct(page);

  const board = page.getByTestId('pane-board');
  await expect(board).toBeVisible();

  // It used to read "View current phase" and navigate to ?view=plans — the
  // Improvement Plan screen, a different feature, which then reported
  // "0 raw findings → 0 plan items". A button that goes somewhere wrong is
  // worse than no button.
  await board.getByRole('button', { name: 'Describe your product' }).click();

  await expect(page).toHaveURL(/view=interview/);
  await expect(
    page.getByRole('heading', { name: 'Describe your product' }),
  ).toBeVisible();
});
