#!/usr/bin/env node
// Red-fixture harness (W3-10, PLAYBOOK.md "planted-defect harness"): proves each
// module-boundary lint rule is actually failing-capable against a forbidden import,
// per law (ARCHITECTURE.md §4 laws 1/2/4, TECH_STACK.md no-deep-imports, SC-04).
//
// Deliberately NOT wired into `pnpm lint` or `pnpm test`: the fixtures must stay out
// of the default `eslint .` scope (they are intentionally broken) and `e2e/` is not a
// vitest.workspace.ts project. Run directly: `pnpm lint:boundary-fixtures`.
// HANDOFF (W3-10, out of write_scope): add this as its own step in
// .github/workflows/ci.yml once that file is in some ticket's write_scope.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import {
  buildDependencyRuleConfig,
  buildPromiseTokenRuleConfig,
} from '../../eslint.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

const CASES = [
  {
    law: 'ARCHITECTURE.md §4 matrix: loop -> tickets',
    file: 'e2e/boundary-fixtures/loop-imports-tickets/violation.ts',
    config: buildDependencyRuleConfig('loop', { includeFixtures: true }),
    ruleId: 'no-restricted-imports',
  },
  {
    law: 'ARCHITECTURE.md §4 matrix: tickets -> git',
    file: 'e2e/boundary-fixtures/tickets-imports-git/violation.ts',
    config: buildDependencyRuleConfig('tickets', { includeFixtures: true }),
    ruleId: 'no-restricted-imports',
  },
  {
    law: 'ARCHITECTURE.md §4 law 2: provider SDK in loop',
    file: 'e2e/boundary-fixtures/provider-sdk-in-loop/violation.ts',
    config: buildDependencyRuleConfig('loop', { includeFixtures: true }),
    ruleId: 'no-restricted-imports',
  },
  {
    law: 'ARCHITECTURE.md §4 law 4: better-sqlite3 in gateway',
    file: 'e2e/boundary-fixtures/better-sqlite3-in-gateway/violation.ts',
    config: buildDependencyRuleConfig('gateway', { includeFixtures: true }),
    ruleId: 'no-restricted-imports',
  },
  {
    law: 'TECH_STACK.md: no deep imports across package boundaries',
    file: 'e2e/boundary-fixtures/deep-import/violation.ts',
    config: buildDependencyRuleConfig('events', { includeFixtures: true }),
    ruleId: 'no-restricted-imports',
  },
  {
    law: 'SC-04: promise-token / string-match completion',
    file: 'e2e/boundary-fixtures/promise-token-in-loop/violation.ts',
    config: buildPromiseTokenRuleConfig('loop', { includeFixtures: true }),
    ruleId: 'no-restricted-syntax',
  },
];

let failures = 0;
for (const { law, file, config, ruleId } of CASES) {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    baseConfig: [{ languageOptions: { parser: tseslint.parser } }, config],
  });
  const [result] = await eslint.lintFiles([file]);
  const hit = result.messages.find((message) => message.ruleId === ruleId);
  if (!hit) {
    failures += 1;
    console.error(
      `NOT FAILING-CAPABLE: ${file} — expected a "${ruleId}" violation for [${law}], got none`,
    );
  } else {
    console.log(`ok — ${file} fails lint as expected (${law})`);
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} of ${CASES.length} red fixture(s) did not prove the gate fails.`,
  );
  process.exit(1);
}
console.log(`\nAll ${CASES.length} boundary red fixtures proven failing-capable.`);
