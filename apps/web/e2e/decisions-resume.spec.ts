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
 * W10-72: a creation run that PAUSES on a founder decision has a path through
 * it — the founder answers the slates and the board gets built.
 *
 * WHY THIS SPEC IS E2E AND NOT A ROUTE TEST. W10-67 built the pause, the
 * persisted run and the resume route, and proved all three in
 * `pipeline-routes/resume.test.ts` against the real gate, the real decisions
 * store and the real on-disk ledger — 8 passing cases. None of it was
 * reachable: `DecisionsBoard` (W5-14) was imported by nothing outside its own
 * directory, and no code in apps/web ever called the resume route. The
 * awaiting screen told the founder to "answer them in Decisions" and there was
 * no Decisions. A route fixture is exactly what could not see that, so the
 * fixture for the fix has to drive a browser.
 *
 * Hermetic the same way `interview.spec.ts` is: a fake gateway seeded into the
 * suite's own DOKIMA_HOME (Law 9 — no network, no real model). The blueprint
 * turn returns two open questions, which is what makes the gate refuse.
 */

const GLOBAL_CONFIG = path.join(HOME, 'config.json');
const MODEL = 'e2e-decisions-model';

const BLUEPRINT_INPUT = JSON.stringify({
  sections: [{ heading: 'Overview', body: 'An e2e project with two real forks.' }],
  openQuestions: [
    {
      key: 'sync-strategy',
      slate: {
        title: 'How does data sync',
        options: [
          { id: 'local-only', label: 'Local only', tradeoffs: 'Fast, single device' },
          { id: 'cloud-sync', label: 'Cloud sync', tradeoffs: 'Multi device, hosting' },
        ],
        recommendedId: 'local-only',
        recommendedReasoning: 'Ships soonest.',
      },
    },
    {
      key: 'platform-scope',
      slate: {
        title: 'Which platforms in v1',
        options: [
          { id: 'mobile-only', label: 'Mobile only', tradeoffs: 'One surface' },
          { id: 'mobile-web', label: 'Mobile and web', tradeoffs: 'Two surfaces' },
        ],
        recommendedId: 'mobile-only',
        recommendedReasoning: 'Smaller team.',
      },
    },
  ],
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
      id: 'D-1',
      type: 'task',
      title: 'Build the sync layer',
      writeScope: ['apps/demo/**'],
      dependsOn: [],
      acceptance: ['It syncs'],
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
      // Three turns for the whole run, spanning TWO http requests: the pause
      // consumes turn 1, and the resume consumes turns 2 and 3. If a resume
      // ever re-ran the blueprint it would consume four, which is what the
      // call-count assertion below is watching for.
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
          updatedAt: '2026-08-04T00:00:00.000Z',
        },
      ],
    }),
  );
});

test.afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
  // Global scope outlives a single spec inside one run, and other specs assert
  // on an unconfigured Settings surface (same reasoning as interview.spec.ts).
  await fs.rm(GLOBAL_CONFIG, { force: true });
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function newProduct(page: Page): Promise<string> {
  const id = randomUUID();
  const dir = path.join(os.tmpdir(), `dokima-decisions-e2e-${id}`);
  const name = `Decisions E2E ${id}`;
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
  await page.locator('.fleet__form').getByRole('button', { name: 'Create project' }).click();

  const card = page.locator('.project-card', { hasText: name });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Open' }).click();
  return name;
}

async function runUntilPaused(page: Page): Promise<void> {
  await newProduct(page);
  await page.getByRole('button', { name: 'Describe' }).click();
  await page.getByLabel('Working title').fill('Shared list');
  // W13-18: by test id, not by index — an answer can now grow an adaptive
  // follow-up textarea beneath it, so a once-taken count is stale.
  const openings = page.locator('[data-testid^="interview-answer-"]');
  for (const opening of await openings.all()) {
    await opening.fill('Answer for the shared list.');
  }
  await page.getByRole('button', { name: 'Build the board' }).click();
  await expect(page.getByTestId('interview-awaiting-decisions')).toBeVisible({
    timeout: 20_000,
  });
}

async function answerSlate(page: Page, optionLabel: string): Promise<void> {
  const card = page.locator('.slate-card', { hasText: optionLabel }).first();
  await card.getByRole('radio', { name: new RegExp(optionLabel) }).check();
  await card.getByRole('button', { name: 'Choose' }).click();
  await expect(card.getByText(/^Decided/)).toBeVisible();
}

test.describe('a paused run has a path through it (W10-72)', () => {
  test('answer the slates, continue, and the board is built — without re-running the blueprint', async ({
    page,
  }) => {
    await runUntilPaused(page);

    // The slates the founder must answer are HERE, on the awaiting screen.
    // Before this ticket they existed only in the database.
    // Scoped to the board: each title also appears in the summary list above
    // it, and an unscoped match would pass on the summary alone — which is the
    // state this ticket exists to fix.
    const slates = page.getByTestId('decisions-board');
    await expect(slates).toBeVisible();
    await expect(
      slates.getByRole('heading', { name: 'How does data sync' }),
    ).toBeVisible();
    await expect(
      slates.getByRole('heading', { name: 'Which platforms in v1' }),
    ).toBeVisible();

    // Continuing with nothing answered is refused by the gate server-side, and
    // must read as "still waiting on you" — not as a failed run. Presenting a
    // correct refusal as a crash is the exact defect W10-67 fixed one screen
    // earlier; it must not reappear here.
    await page.getByTestId('interview-continue').click();
    await expect(page.getByTestId('interview-still-waiting')).toBeVisible();
    await expect(page.getByTestId('interview-resume-error')).toHaveCount(0);

    await answerSlate(page, 'Cloud sync');
    await answerSlate(page, 'Mobile only');

    // The notice must not outlive the condition it describes: left standing, a
    // present-tense "still awaiting a decision on …" tells a founder who has
    // just answered that they have not.
    await expect(page.getByTestId('interview-still-waiting')).toHaveCount(0);

    await page.getByTestId('interview-continue').click();

    const board = page.locator('[data-testid="pane-board"]');
    await expect(board.getByTestId('card-PLAN-D-1')).toBeVisible({ timeout: 20_000 });
    await expect(board.getByTestId('card-PLAN-D-1')).toContainText(
      'Build the sync layer',
    );

    // THREE model calls for the whole run, not four. The blueprint was paid for
    // before the pause and its INPUT was persisted; a resume that re-derived it
    // would spend a fourth call and — worse — could produce different slates
    // than the ones the founder just answered.
    expect(gateway?.callCounts[MODEL]).toBe(3);
  });

  test('the Decisions board is reachable on its own, not only from a paused run', async ({
    page,
  }) => {
    await runUntilPaused(page);

    // Opening Decisions from the header finds the same two open slates. This
    // is the half that did not exist at all: the component shipped in W5-14
    // and was mounted nowhere.
    //
    // W13-01 made this stronger rather than just different: it used to require
    // clicking "← Back" FIRST, because opening any view replaced the whole nav
    // with that one control. The destination set is stable now, so Decisions is
    // reachable from wherever you are — which is the behaviour this test is
    // really about, and the detour was evidence of the defect.
    await page.getByRole('button', { name: 'Decisions' }).click();

    const board = page.getByTestId('decisions-board');
    await expect(board).toBeVisible();
    await expect(
      board.getByRole('heading', { name: 'How does data sync' }),
    ).toBeVisible();
    await expect(
      board.getByRole('heading', { name: 'Which platforms in v1' }),
    ).toBeVisible();
  });
});
