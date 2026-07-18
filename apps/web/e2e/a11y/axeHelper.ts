import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * WCAG 2.2 AA scan (UX_SPEC §9, docs/TESTING.md §7 "axe scan per routed
 * page"). Tags are cumulative per axe-core's own convention — 2.2 AA
 * includes everything 2.0/2.1 A/AA already require.
 */
const WCAG22AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

export async function scanForA11yViolations(page: Page, includeSelector?: string) {
  let builder = new AxeBuilder({ page }).withTags(WCAG22AA_TAGS);
  if (includeSelector) builder = builder.include(includeSelector);
  const results = await builder.analyze();
  return results.violations;
}
