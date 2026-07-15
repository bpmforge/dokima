import { expect, test } from '@playwright/test';

/**
 * Chat workspace (UX_SPEC §3, FR-C2) against the real apps/server. The
 * `GET /api/v1/projects/:id/chat` route (server.ts) currently replays a
 * fixture event stream — SRS's own FR-C2 acceptance wording ("Fixture
 * event stream renders all four card types") — since no chat/message
 * producer exists yet; this suite proves the real wiring (REST fetch, the
 * `pane-chat` portal mount, card rendering, provenance, receipt
 * click-through), not the fixture content itself (covered by
 * `apps/web/src/chat/reduceChatEvents.test.ts`).
 */

test('the program thread and an agent thread render inside the chat pane', async ({
  page,
}) => {
  await page.goto('/?project=chat-e2e-default');
  const chatPane = page.getByTestId('pane-chat');
  await expect(chatPane.getByTestId('chat-view')).toBeVisible();
  await expect(chatPane.getByTestId('chat-thread-thread-program')).toBeVisible();
  await expect(chatPane.getByTestId('chat-thread-thread-w4-04-security')).toBeVisible();
});

test('all four structured card types render with agent/model/ticket/cost provenance', async ({
  page,
}) => {
  await page.goto('/?project=chat-e2e-cards');
  const chatPane = page.getByTestId('pane-chat');

  const question = chatPane.getByTestId('chat-card-card-question-1');
  await expect(question).toHaveAttribute('data-kind', 'question');
  const finding = chatPane.getByTestId('chat-card-card-finding-1');
  await expect(finding).toHaveAttribute('data-kind', 'finding');
  const manifest = chatPane.getByTestId('chat-card-card-manifest-1');
  await expect(manifest).toHaveAttribute('data-kind', 'manifest');
  const slate = chatPane.getByTestId('chat-card-card-slate-1');
  await expect(slate).toHaveAttribute('data-kind', 'slate');

  for (const card of [question, finding, manifest, slate]) {
    await expect(card.getByTestId('card-agent')).not.toBeEmpty();
    await expect(card.getByTestId('card-model')).not.toBeEmpty();
    await expect(card.getByTestId('card-ticket')).toHaveText('W4-04');
    await expect(card.getByTestId('card-cost-link')).toContainText('$0.');
  }
});

test("clicking a card's cost click-throughs to its receipt (FR-C2)", async ({ page }) => {
  await page.goto('/?project=chat-e2e-receipt');
  const costLink = page
    .getByTestId('pane-chat')
    .getByTestId('chat-card-card-finding-1')
    .getByTestId('card-cost-link');
  await expect(costLink).toHaveAttribute('href', '/api/v1/receipts/rcpt_chat_f1');
});

test('the chat pane is independently collapsible like the other panes', async ({
  page,
}) => {
  await page.goto('/?project=chat-e2e-collapse');
  const chatHeader = page.getByTestId('pane-chat').getByRole('button');
  await chatHeader.click();
  await expect(page.getByTestId('pane-chat')).toHaveAttribute('data-collapsed', 'true');
});
