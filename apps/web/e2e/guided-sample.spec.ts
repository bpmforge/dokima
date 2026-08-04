import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import { HOME } from './env-paths.js';
import {
  startFakeModelGateway,
  type FakeModelGateway,
} from './fixtures/fake-model-gateway.js';

/**
 * W10-55 acceptance 5, verbatim: "an e2e spec that completes the guided sample
 * and asserts the sample project has a non-zero event count."
 *
 * The ticket was filed after driving the installed package and finding the
 * sample project on disk with `events 0, receipts 0, no tickets table` while
 * the wizard's own copy promised the idea had been run "on your configured
 * model". Four separate pipeline defects have been fixed since it was filed
 * (W10-59 fenced JSON, W10-65 an empty field, W10-66 a field in the wrong
 * format, W10-69 the wrong model entirely), so this spec exists to MEASURE
 * whether the claim is true now rather than assume it either way.
 *
 * Hermetic per law 9, the same shape as `interview.spec.ts`: a fake gateway
 * seeded into the suite's own DOKIMA_HOME, no network and no real model.
 */

const GLOBAL_CONFIG = path.join(HOME, 'config.json');
const MODEL = 'e2e-guided-sample-model';

const BLUEPRINT_INPUT = JSON.stringify({
  sections: [{ heading: 'Overview', body: 'A link shortener with auth.' }],
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
      id: 'S-1',
      type: 'task',
      title: 'Create the short-link table',
      writeScope: ['src/db/**'],
      dependsOn: [],
      acceptance: ['links persist'],
      verify: 'pnpm test',
      ownPackage: 'apps/demo',
      importsWorkspacePackages: [],
      providesInterfaces: [],
      consumesInterfaces: [],
    },
  ],
});

let gateway: FakeModelGateway | undefined;

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
          updatedAt: '2026-08-04T00:00:00.000Z',
        },
      ],
    }),
  );
});

test.afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
  await fs.rm(GLOBAL_CONFIG, { force: true });
  // The wizard hardcodes `/tmp/dokima-sample-<ts>` and nothing cleaned these
  // up: 179 of them had accumulated by the time this spec was written. That is
  // W9-14's lesson in a new place (a registry that grew to 1,164 projects took
  // trace.spec.ts red and the suite from 22s to 3.7m), and it is a latent
  // FLAKE here too, since `newestSampleProject` picks by sort order.
  const created = (await fs.readdir('/tmp')).filter((e) =>
    e.startsWith('dokima-sample-'),
  );
  await Promise.all(
    created.map((e) => fs.rm(path.join('/tmp', e), { recursive: true, force: true })),
  );
});

/** Newest `dokima-sample-*` the wizard created, since it names them by timestamp. */
async function newestSampleProject(): Promise<string> {
  // `/tmp` literally, not `os.tmpdir()`: FirstRunWizard hardcodes
  // `/tmp/dokima-sample-<ts>`, and on macOS os.tmpdir() is /var/folders/...
  const tmp = '/tmp';
  const entries = await fs.readdir(tmp);
  const samples = entries.filter((e) => e.startsWith('dokima-sample-')).sort();
  const last = samples[samples.length - 1];
  expect(last, 'the wizard should have created a sample project').toBeTruthy();
  return path.join(tmp, last!);
}

test('RED FIXTURE: the guided sample really runs, and the sample project has real events', async ({
  page,
}) => {
  // The pipeline is three model calls; the default 30s test budget is not
  // enough to tell "slow" from "hung", which is the distinction this measures.
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Run Setup Wizard' }).click();

  await page.getByLabel(/Hybrid/).check();
  await page
    .getByTestId('wizard-step-preset')
    .getByRole('button', { name: 'Next' })
    .click();
  // POINT THE WIZARD AT THE FAKE GATEWAY. The Base URL is pre-filled with
  // http://localhost:1234/v1, and accepting it is what a real first run does —
  // but in a test it silently reaches whatever LM Studio happens to be running
  // on the developer's box. Measured: the first version of this spec did
  // exactly that, spent 42s on a real 35B model and recorded ZERO calls to the
  // fake gateway. Law 9 is not satisfied by a suite that only usually has no
  // network.
  await page.getByLabel('Base URL').fill(`${gateway!.url}/v1`);
  await page
    .getByTestId('wizard-step-provider')
    .getByRole('button', { name: 'Next' })
    .click();
  await page
    .getByTestId('wizard-step-forge')
    .getByRole('button', { name: 'Skip' })
    .click();

  await expect(page.getByTestId('wizard-step-sample')).toBeVisible();
  await page.getByRole('button', { name: 'Create sample project' }).click();

  // Walk every interview beat, then run the idea.
  await expect(page.getByTestId('guided-sample-interview')).toBeVisible();
  for (let i = 0; i < 20; i += 1) {
    const next = page.getByTestId('guided-sample-next-beat');
    if ((await next.count()) === 0) break;
    await next.click();
  }
  await expect(page.getByTestId('guided-sample-ready')).toBeVisible();
  await page.getByTestId('guided-sample-run').click();

  // The claim under test: it ran, rather than degrading with an excuse.
  const outcome = page
    .getByTestId('guided-sample-success')
    .or(page.getByTestId('guided-sample-degraded'));
  await expect(outcome).toBeVisible({ timeout: 90_000 });
  const degraded = page.getByTestId('guided-sample-degraded');
  if ((await degraded.count()) > 0) {
    throw new Error(
      `guided sample DEGRADED (gateway calls: ${JSON.stringify(gateway?.callCounts)}): ` +
        (await degraded.innerText()),
    );
  }
  expect(gateway?.callCounts[MODEL], 'the FAKE gateway must be the one called').toBe(3);

  const projectPath = await newestSampleProject();
  const db = new DatabaseSync(path.join(projectPath, '.dokima', 'state.db'), {
    readOnly: true,
  });
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
    // Filed measurement: `events 0`. The wizard promised the idea had been run
    // on the configured model; the artifact kept nothing.
    expect(row.n).toBeGreaterThan(0);
  } finally {
    db.close();
  }
});
