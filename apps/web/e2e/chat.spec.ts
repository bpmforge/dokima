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

test("clicking a card's cost opens its receipt in-app, never a raw API page (FR-C2, review C2)", async ({
  page,
}) => {
  await page.goto('/?project=chat-e2e-receipt');
  const chatPane = page.getByTestId('pane-chat');
  const costLink = chatPane.getByTestId('chat-card-card-finding-1').getByTestId('card-cost-link');
  await expect(costLink).not.toHaveAttribute('href', /.*/);
  await costLink.click();
  await expect(page).toHaveURL(/\?project=chat-e2e-receipt/);
  // The sample receipt id resolves to a receipt or an honest error — either
  // way it is shown in the pane, and the tab stays in the app.
  await expect(chatPane.getByTestId('chat-receipt')).toBeVisible();
  await expect(chatPane.getByTestId('chat-receipt')).toContainText('rcpt_chat_f1');
});

test('the chat pane is independently collapsible like the other panes', async ({
  page,
}) => {
  await page.goto('/?project=chat-e2e-collapse');
  // W12-34: the pane header now carries a Focus button as well as the
  // collapse toggle, so an unnamed getByRole('button') is ambiguous. Target
  // the collapse control by its accessible name — more precise regardless.
  const chatHeader = page
    .getByTestId('pane-chat')
    .getByRole('button', { name: /Collapse Chat|Expand Chat/ });
  await chatHeader.click();
  await expect(page.getByTestId('pane-chat')).toHaveAttribute('data-collapsed', 'true');
});

test('a failed chat history fetch surfaces a distinct error state, not a fabricated empty state', async ({
  page,
}) => {
  await page.route('**/api/v1/projects/chat-e2e-fetch-error/chat', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"detail":"unauthorized"}',
    }),
  );
  await page.goto('/?project=chat-e2e-fetch-error');
  const chatPane = page.getByTestId('pane-chat');
  await expect(chatPane.getByTestId('chat-load-error')).toBeVisible();
  await expect(chatPane.getByTestId('chat-empty-state')).toHaveCount(0);
});

test('a person replies from the chat pane through the ticket comment verb, and the reply shows as a human message', async ({
  page,
}) => {
  // Both ends are routed: this pins the WIRING (pane → `POST /tickets/:id/comment`
  // → re-read of the chat), not the server's projection, which
  // `chat-projection.test.ts` covers against a real event log.
  const sub = 'chat:chat-e2e-reply';
  const prov = { agent: 'worker-1', model: 'm', ticket_id: 'E2E-1', cost_usd: 0, receipt_id: '' };
  const base = [
    { sub, seq: 1, type: 'thread.opened', at: '2026-10-15T10:00:00Z', data: { id: 'thread-program', kind: 'program', concern: null } },
    {
      sub, seq: 2, type: 'card.finding', at: '2026-10-15T10:00:00Z',
      data: { id: 'finding-2', thread_id: 'thread-program', provenance: prov, severity: 'high', issue: 'Parked with evidence', evidence_href: '' },
    },
  ];
  const reply = {
    sub, seq: 3, type: 'message.human', at: '2026-10-15T10:01:00Z',
    data: { id: 'reply-3', thread_id: 'thread-program', author: 'Operator', ticket_id: 'E2E-1', body: 'Keep the old endpoint.', at: '2026-10-15T10:01:00Z' },
  };
  let sent: unknown = null;
  await page.route('**/api/v1/projects/chat-e2e-reply/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: sent ? [...base, reply] : base }),
    }),
  );
  await page.route('**/api/v1/tickets/E2E-1/comment?project=chat-e2e-reply', (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"E2E-1"}' });
  });

  await page.goto('/?project=chat-e2e-reply');
  const chatPane = page.getByTestId('pane-chat');
  await chatPane.getByRole('button', { name: 'Reply on E2E-1' }).click();
  const box = chatPane.getByLabel('Your reply on E2E-1');
  await expect(box).toBeFocused();
  await box.fill('Keep the old endpoint.');
  await box.press('Control+Enter');
  await expect(chatPane.getByTestId('chat-human-reply-3')).toContainText('Keep the old endpoint.');
  expect(sent).toEqual({ body: 'Keep the old endpoint.' });
  await expect(chatPane.getByTestId('chat-composer-status')).toHaveText('Reply saved to E2E-1.');
});
