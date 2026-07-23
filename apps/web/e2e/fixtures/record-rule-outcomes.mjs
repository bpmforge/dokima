/**
 * Records FP outcomes against a project's `rule_state` table through the
 * real `recordRuleOutcome` store function (rule-state-store.ts) for
 * plans.spec.ts's AC2 regression test. There is no HTTP route for outcome
 * recording yet (the store's own header: "No live findings producer is
 * wired to call this yet") — same real-code-via-fixture discipline as
 * `seed-board-tickets.mjs`. Run via the real `tsx` binary so the dynamic
 * `import()` of apps/server TS source gets transformed; apps/web has no
 * dependency path to apps/server (pnpm strict mode), so an absolute-path
 * dynamic import is the only route in, same as seed-board-tickets.mjs.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

const storeUrl = pathToFileURL(
  path.join(repoRoot, 'apps', 'server', 'src', 'api', 'server', 'rule-state-store.ts'),
).href;
const { recordRuleOutcome } = await import(storeUrl);

const [, , projectPath, ruleId, fpCountArg] = process.argv;
const fpCount = Number(fpCountArg);
if (!projectPath || !ruleId || !Number.isInteger(fpCount) || fpCount < 1) {
  console.error('usage: record-rule-outcomes.mjs <projectPath> <ruleId> <fpCount>');
  process.exit(1);
}

for (let i = 0; i < fpCount; i += 1) {
  await recordRuleOutcome(projectPath, ruleId, true);
}
