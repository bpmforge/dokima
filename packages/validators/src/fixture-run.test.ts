import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadValidatorPack } from './pack.js';
import { runValidatorPack } from './run.js';
import { createTempDir, type TempDir } from './test-helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_VALIDATORS_DIR = path.resolve(
  HERE,
  '..',
  '..',
  '..',
  'content',
  'validators',
);

/**
 * The subset of the imported pack exercised here (acceptance criterion 3:
 * "at least 10 imported validators run green"). Each of these auto-detects
 * its project root from `cwd` (no positional arg required) and degrades to
 * a clean skip when its target artifact is absent — real validators from
 * content/validators/, run against a real (if minimal) fixture project,
 * not stubs.
 */
const GREEN_VALIDATOR_NAMES = [
  'validate-adrs',
  'validate-no-ascii-art',
  'validate-file-size',
  'validate-doc-catalog',
  'validate-build',
  'validate-tech-stack',
  'validate-lint',
  'validate-smoke',
  'validate-deps',
  'validate-migrations',
  'validate-dead-code',
  'validate-circular-deps',
  'validate-user-stories',
  'validate-use-cases',
  'validate-tickets',
  'validate-requirements-matrix',
  'validate-ux-spec',
];

const CLEAN_ARCHITECTURE_MD = `# Architecture

No UI — UX branch not applicable.

This is a minimal fixture project used to exercise the Shipwright validator pack contract.
`;

const VALID_REQUIREMENTS_MATRIX_MD = `# Requirements Matrix

| FR | Use Case | Test | Status |
|----|----------|------|--------|
| FR-1 | Fixture only | fixture.test.ts | Verified |
`;

async function buildGreenFixture(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'docs', 'ARCHITECTURE.md'), CLEAN_ARCHITECTURE_MD);
  await fs.writeFile(
    path.join(dir, 'docs', 'REQUIREMENTS_MATRIX.md'),
    VALID_REQUIREMENTS_MATRIX_MD,
  );
}

describe('imported validator pack against a fixture project', () => {
  let temp: TempDir;

  afterEach(async () => {
    await temp?.cleanup();
  });

  it('runs at least 10 real imported validators green (exit 0, 0 gaps)', async () => {
    temp = await createTempDir('green-fixture');
    await buildGreenFixture(temp.dir);

    const specs = await loadValidatorPack({
      contentDir: CONTENT_VALIDATORS_DIR,
      select: GREEN_VALIDATOR_NAMES,
    });
    expect(specs.length).toBeGreaterThanOrEqual(10);

    const results = await runValidatorPack(specs, { cwd: temp.dir, timeoutMs: 15_000 });

    const failed = results.filter((r) => r.exitCode !== 0);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(results).toHaveLength(GREEN_VALIDATOR_NAMES.length);
    for (const result of results) {
      expect(result.gapCount).toBe(0);
    }
  });

  it('red fixtures prove 3 validators fail when the defect they check for is present', async () => {
    temp = await createTempDir('red-fixture');
    await fs.mkdir(path.join(temp.dir, 'docs'), { recursive: true });

    // Defect 1: no UX_SPEC.md and no "No UI" declaration -> validate-ux-spec.
    await fs.writeFile(
      path.join(temp.dir, 'docs', 'ARCHITECTURE.md'),
      '# Architecture\n\nThis project has a UI but no UX spec has been written yet.\n',
    );
    // Defect 2: docs/REQUIREMENTS_MATRIX.md deliberately omitted -> validate-requirements-matrix.
    // Defect 3: a 40+ char ASCII banner line -> validate-no-ascii-art.
    await fs.writeFile(
      path.join(temp.dir, 'docs', 'BANNER.md'),
      `# Banner doc\n\n${'='.repeat(45)}\nAbove is a banner line that should trip validate-no-ascii-art.\n`,
    );

    const redNames = [
      'validate-ux-spec',
      'validate-requirements-matrix',
      'validate-no-ascii-art',
    ];
    const specs = await loadValidatorPack({
      contentDir: CONTENT_VALIDATORS_DIR,
      select: redNames,
    });
    const results = await runValidatorPack(specs, { cwd: temp.dir, timeoutMs: 15_000 });

    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.exitCode).toBe(1);
      expect(result.gapCount).toBeGreaterThan(0);
    }
  });
});
