import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { HOME } from './env-paths.js';
import {
  startFakeModelGateway,
  type FakeModelGateway,
} from './fixtures/fake-model-gateway.js';

/**
 * W10-61, and the assertion W10-54 transferred here: drive the interview
 * through the UI and assert the board is non-empty afterwards WITHOUT a page
 * reload.
 *
 * The "without a reload" clause is the entire point. The board rows were
 * always committed — 9 plan_items, measured — but `paneNodes.ts` keyed its
 * `document.querySelector` on `projectId`, and `MainView` unmounts
 * `SplitPaneWorkspace` for every full-screen view. Coming back from Describe
 * built fresh pane nodes while the hooks still held the detached originals,
 * so all three panes rendered empty and a reload "fixed" it. A spec that
 * reloads to go green asserts the workaround.
 *
 * HERMETIC WITHOUT TOUCHING playwright.config.ts: the suite already owns
 * `DOKIMA_HOME`, and W10-62/W10-64 made the provider registry and the model
 * matrix resolvable from global scope. So this seeds both into that home,
 * pointed at a fake gateway this spec starts — no network, no real model
 * (Law 9), and no project-scope setup to click through. It also means this
 * spec is the end-to-end exercise of those two tickets as a side effect.
 */

const GLOBAL_CONFIG = path.join(HOME, 'config.json');
const MODEL = 'e2e-pipeline-model';

const BLUEPRINT_INPUT = JSON.stringify({
  sections: [{ heading: 'Overview', body: 'An e2e project with no open forks.' }],
  openQuestions: [],
});

const TECHNICAL_SLATE_INPUT = JSON.stringify({
  title: 'Storage approach',
  options: ['Minimal', 'Clean', 'Pragmatic'].map((label) => ({
    label,
    summary: `${label} storage`,
    dimensions: {
      time: 'medium',
      maintainability: 'medium',
      scalability: 'medium',
      'team-fit': 'ok',
      risk: 'low',
      reversibility: 'medium',
    },
  })),
  recommendedLabel: 'Pragmatic',
  recommendedConstraint: 'ship in one week',
});

const TICKET_DRAFTS = JSON.stringify({
  tickets: [
    {
      id: 'T-1',
      type: 'task',
      title: 'Render the interval timer',
      writeScope: ['apps/demo/**'],
      dependsOn: [],
      acceptance: ['It counts down'],
      verify: 'pnpm test',
      ownPackage: 'apps/demo',
      importsWorkspacePackages: [],
      providesInterfaces: [],
      consumesInterfaces: [],
    },
  ],
});

let gateway: FakeModelGateway | undefined;
const dirs: string[] = [];

test.beforeEach(async () => {
  gateway = await startFakeModelGateway({
    scripts: {
      [MODEL]: [
        { content: BLUEPRINT_INPUT },
        { content: TECHNICAL_SLATE_INPUT },
        { content: TICKET_DRAFTS },
      ],
    },
  });
  await fs.mkdir(HOME, { recursive: true });
  await fs.writeFile(
    GLOBAL_CONFIG,
    JSON.stringify({
      providers: [
        {
          id: 'e2e-gateway',
          kind: 'oai-compat',
          baseUrl: `${gateway.url}/v1`,
          enabled: true,
        },
      ],
      model_matrix: [
        {
          role: 'coding-agent',
          taskType: 'reasoning',
          model: MODEL,
          fallback: [],
          updatedAt: '2026-08-03T00:00:00.000Z',
        },
      ],
    }),
  );
});

test.afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
  // Global scope outlives a single spec inside one run, and other specs assert
  // on an unconfigured Settings surface — leaving this behind would make THEM
  // fail, in a different file, for a reason nothing in them mentions.
  await fs.rm(GLOBAL_CONFIG, { force: true });
  // The server can still be writing .dokima state (WAL checkpoints) when this
  // runs, and a recursive rm racing a writer throws ENOTEMPTY — observed once
  // the suite grew a third spec in this file (W16-06). Bounded retry, not
  // `force`-and-hope: any other error still fails the test.
  await Promise.all(
    dirs.splice(0).map(async (d) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await fs.rm(d, { recursive: true, force: true });
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (attempt >= 4 || (code !== 'ENOTEMPTY' && code !== 'EBUSY')) throw err;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }),
  );
});

async function newProduct(page: Page): Promise<string> {
  const id = randomUUID();
  const dir = path.join(os.tmpdir(), `dokima-interview-e2e-${id}`);
  const name = `Interview E2E ${id}`;
  dirs.push(dir);
  await fs.mkdir(dir, { recursive: true });

  await page.goto('/');
  const header = page.locator('.fleet__header');
  await header.getByRole('button', { name: 'New project', exact: true }).click();
  // W12-41: New project asks only for a name now — the server creates
  // the folder. These specs need a controlled tmpdir, so they take the
  // explicit-location escape, which also keeps that path covered.
  await page.getByRole('button', { name: 'choose the location' }).click();
  await page.getByLabel('Folder').fill(dir);
  await page.getByLabel('Project name').fill(name);
  await page
    .locator('.fleet__form')
    .getByRole('button', { name: 'Create project' })
    .click();

  const card = page.locator('.project-card', { hasText: name });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Open' }).click();
  return name;
}

test.describe('interview -> board, in one pass (W10-61, inherited W10-54 AC5)', () => {
  test('builds a non-empty board and renders it WITHOUT a page reload', async ({
    page,
  }) => {
    await newProduct(page);

    await page.getByRole('button', { name: 'Describe' }).click();
    await page.getByLabel('Working title').fill('Interval timer');
    // W13-18: address the OPENING questions by their own test id, never by
    // positional index. Answering a question can now add an adaptive follow-up
    // textarea beneath it (AC-1), so a snapshot of `textarea` count taken once
    // and indexed into is stale the moment the first answer lands. Same lesson
    // as W12-36's selectors: a locator that depends on the DOM not growing is
    // a latent break, not a passing test.
    const openings = page.locator('[data-testid^="interview-answer-"]');
    for (const opening of await openings.all()) {
      await opening.fill('Answer for the interval timer.');
    }

    await page.getByRole('button', { name: 'Build the board' }).click();

    // Back on the Canvas, with NO page.reload() anywhere in this spec.
    const board = page.locator('[data-testid="pane-board"]');
    await expect(board).toBeVisible();
    // The decomposed ticket, as a real board card. `getByText` matches twice
    // here — the card AND the board-strip entry — which is itself evidence
    // the board rendered; the card is the specific thing being asserted.
    await expect(board.getByTestId('card-PLAN-T-1')).toBeVisible({ timeout: 20_000 });
    await expect(board.getByTestId('card-PLAN-T-1')).toContainText(
      'Render the interval timer',
    );
  });

  test(
    'RED FIXTURE (W16-06): a failed run speaks plain language first — the ' +
      'primary error line never shows a bare "(HTTP" marker',
    async ({ page }) => {
      await newProduct(page);

      await page.getByRole('button', { name: 'Describe' }).click();
      await page.getByLabel('Working title').fill('Interval timer');
      const openings = page.locator('[data-testid^="interview-answer-"]');
      for (const opening of await openings.all()) {
        await opening.fill('Answer for the interval timer.');
      }

      // Force the novice's worst first minute: the run POST fails server-side.
      await page.route('**/pipeline/run', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({ detail: 'planted e2e failure' }),
        }),
      );
      await page.getByRole('button', { name: 'Build the board' }).click();

      const alert = page.getByTestId('interview-error');
      await expect(alert).toBeVisible();
      await expect(alert).not.toContainText('(HTTP');
      await expect(alert).not.toContainText('planted e2e failure');
      await expect(alert).toContainText(/try again/i);
      // Kept, demoted: the raw string lives in the closed disclosure.
      await expect(page.getByTestId('interview-error-detail')).toContainText(
        'planted e2e failure (HTTP 500)',
      );
      // The form survived the failure — nothing typed was lost.
      await expect(page.getByLabel('Working title')).toHaveValue('Interval timer');
    },
  );

  test('the other two panes come back too — the stale-portal-target regression', async ({
    page,
  }) => {
    await newProduct(page);

    // Chat and Artifacts render on first open...
    await expect(page.locator('[data-testid="pane-chat"]')).not.toBeEmpty();
    await expect(page.locator('[data-testid="pane-artifacts"]')).not.toBeEmpty();

    // ...leave to a full-screen view and come back. This is the exact
    // transition that detached every pane node, and it is not specific to the
    // interview — Roster does it too, which is why it is asserted separately
    // from the pipeline run above.
    await page.getByRole('button', { name: 'Roster' }).click();
    await expect(page.locator('[data-testid="pane-board"]')).toHaveCount(0);
    await page.goBack();

    await expect(page.locator('[data-testid="pane-chat"]')).not.toBeEmpty();
    await expect(page.locator('[data-testid="pane-board"]')).not.toBeEmpty();
    await expect(page.locator('[data-testid="pane-artifacts"]')).not.toBeEmpty();
  });
});
