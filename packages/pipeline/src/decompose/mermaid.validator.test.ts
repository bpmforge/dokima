import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decompose } from './decompose.js';
import type { TicketDraftInput } from './types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VALIDATOR = path.resolve(
  HERE,
  '../../../../content/validators/validate-mermaid.sh',
);

function draft(overrides: Partial<TicketDraftInput> & { id: string }): TicketDraftInput {
  return {
    type: 'task',
    title: overrides.id,
    writeScope: [],
    dependsOn: [],
    acceptance: [],
    verify: 'true',
    ownPackage: null,
    importsWorkspacePackages: [],
    providesInterfaces: [],
    consumesInterfaces: [],
    ...overrides,
  };
}

/**
 * The mermaid.test.ts suite hand-mirrors validate-mermaid.sh's static checks
 * (M001-M012), which only proves the mirror is internally consistent — not
 * that it matches the real validator's regexes. This runs the actual script
 * (the one every phase gate's validator set includes, R-H3) against
 * renderMermaid's output so "a broken diagram cannot gate-pass" is checked
 * against the real gate, not an assumption about it.
 */
describe('renderMermaid output against the real validate-mermaid.sh (R-H3)', () => {
  it('an adversarial-title DAG passes the real validator with zero errors', () => {
    const plan = decompose([
      draft({
        id: 'A',
        title:
          'Do (async)/parse | commit `code` **bold** "quoted" — em—dash "smart" value',
        writeScope: ['packages/a/**'],
      }),
      draft({
        id: 'end',
        title: 'reserved-id check -> unicode arrow →',
        writeScope: ['packages/b/**'],
        dependsOn: ['A'],
      }),
      draft({
        id: 'C',
        title: 'Fix bug in [Feature X',
        writeScope: ['packages/c/**'],
        dependsOn: ['A'],
      }),
    ]);

    const dir = mkdtempSync(path.join(tmpdir(), 'decompose-mermaid-'));
    const docsDir = path.join(dir, 'docs');
    mkdirSync(docsDir);
    writeFileSync(
      path.join(docsDir, 'PLAN.md'),
      `\`\`\`mermaid\n${plan.mermaid}\n\`\`\`\n`,
    );

    let stdout = '';
    let exitCode = 0;
    try {
      stdout = execFileSync('bash', [VALIDATOR, dir, docsDir], {
        encoding: 'utf-8',
        env: { ...process.env, EXPERTS_TELEMETRY: '0', MERMAID_NO_RENDER: '1' },
      });
    } catch (err) {
      const failure = err as { status?: number; stdout?: string };
      exitCode = failure.status ?? 1;
      stdout = failure.stdout ?? '';
    }

    const findings = stdout
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { severity: string; code: string });
    const errors = findings.filter((f) => f.severity === 'error');

    expect(errors, JSON.stringify(errors)).toEqual([]);
    expect(exitCode).toEqual(0);
  });
});
