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
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
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
  await page.getByLabel('Directory path').fill(dir);
  await page.getByLabel('Name (optional)').fill(name);
  await page.locator('.fleet__form').getByRole('button', { name: 'Create project' }).click();

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
    const answers = page.locator('textarea');
    const count = await answers.count();
    for (let i = 0; i < count; i += 1) {
      await answers.nth(i).fill(`Answer ${i + 1} for the interval timer.`);
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
