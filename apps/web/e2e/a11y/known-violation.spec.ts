import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { scanForA11yViolations } from './axeHelper.js';

/**
 * A green axe run on every real page proves nothing on its own unless the
 * gate can also fail — same "prove the trust boundary holds" discipline
 * TESTING.md §6 applies to gate-integrity fixtures, applied here to the
 * a11y gate. `e2e/a11y/known-violation.html` (top-level fixture, not
 * served by apps/server — a static file is enough to exercise axe-core
 * itself) plants two real WCAG 2.2 AA violations; this asserts axe
 * actually catches both, independent of the real apps/server `webServer`.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  here,
  '../../../..',
  'e2e',
  'a11y',
  'known-violation.html',
);

test('axe catches the planted image-alt and color-contrast violations (gate has teeth)', async ({
  page,
}) => {
  await page.goto(`file://${fixturePath}`);
  const violations = await scanForA11yViolations(page);
  const ruleIds = violations.map((v) => v.id);
  expect(ruleIds).toContain('image-alt');
  expect(ruleIds).toContain('color-contrast');
});
