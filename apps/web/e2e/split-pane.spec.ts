import { expect, test } from '@playwright/test';

/** FR-C1: resize + collapse, restart/reload -> layout identical per project; two projects hold different layouts. */

test('collapsing a pane persists across reload', async ({ page }) => {
  await page.goto('/?project=proj-collapse');
  const boardHeader = page.getByTestId('pane-board').getByRole('button');
  await boardHeader.click(); // collapse
  await expect(page.getByTestId('pane-board')).toHaveAttribute('data-collapsed', 'true');

  await page.reload();
  await expect(page.getByTestId('pane-board')).toHaveAttribute('data-collapsed', 'true');
});

test('resizing a pane via the divider persists across reload', async ({ page }) => {
  await page.goto('/?project=proj-resize');
  const divider = page.getByTestId('divider-chat-board');
  const box = await divider.boundingBox();
  if (!box) throw new Error('divider has no bounding box');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2);
  await page.mouse.up();

  const chatPane = page.getByTestId('pane-chat');
  const widthAfterDrag = (await chatPane.boundingBox())?.width;
  expect(widthAfterDrag).toBeDefined();

  await page.reload();
  const widthAfterReload = (await chatPane.boundingBox())?.width;
  expect(Math.round(widthAfterReload ?? 0)).toBe(Math.round(widthAfterDrag ?? 0));
});

test('two different projects hold independent layouts', async ({ page }) => {
  await page.goto('/?project=proj-a');
  await page.getByTestId('pane-artifacts').getByRole('button').click(); // collapse in proj-a only
  await expect(page.getByTestId('pane-artifacts')).toHaveAttribute(
    'data-collapsed',
    'true',
  );

  await page.goto('/?project=proj-b');
  await expect(page.getByTestId('pane-artifacts')).toHaveAttribute(
    'data-collapsed',
    'false',
  );

  await page.goto('/?project=proj-a');
  await expect(page.getByTestId('pane-artifacts')).toHaveAttribute(
    'data-collapsed',
    'true',
  );
});
