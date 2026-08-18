import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectSecretValues,
  createInMemoryCredentialStore,
  createProjectSecretsVault,
} from '@dokima/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { renderHandoff, type Handoff } from './handoff.js';
import { parseCompletionManifest } from './session-manifest.js';

const SAMPLE: Handoff = {
  role: 'coding-agent',
  mission: 'implement the ticket',
  ticket: { id: 'W1-06', title: 'HANDOFF contract + agent session runner' },
  context: 'relevant docs, interfaces, prior findings',
  writeScope: ['packages/loop/src/handoff*', 'packages/loop/src/session*'],
  produce: ['acceptance criterion 1', 'acceptance criterion 2'],
  verify: 'pnpm test --filter loop',
};

describe('renderHandoff', () => {
  it(
    'renders the universal block format from BLUEPRINT §4. The field lines are ' +
      'asserted exactly; the RETURN section is asserted by its contract (W13-09) ' +
      'rather than by its literal text, because pinning a prompt byte-for-byte ' +
      'makes improving it look like a regression',
    () => {
      const lines = renderHandoff(SAMPLE).split('\n');
      expect(lines.slice(0, 7)).toEqual([
        '════════════════════════════════════════',
        'ROLE: coding-agent — implement the ticket',
        'TICKET: W1-06 HANDOFF contract + agent session runner',
        'CONTEXT: relevant docs, interfaces, prior findings',
        'WRITE-SCOPE: packages/loop/src/handoff*, packages/loop/src/session*',
        'PRODUCE: acceptance criterion 1; acceptance criterion 2',
        'VERIFY: pnpm test --filter loop',
      ]);
      expect(lines[lines.length - 1]).toBe('════════════════════════════════════════');
    },
  );

  it('opens and closes with a 40-character rule, matching the BLUEPRINT literal', () => {
    const lines = renderHandoff(SAMPLE).split('\n');
    expect(lines[0]).toBe('═'.repeat(40));
    expect(lines[lines.length - 1]).toBe('═'.repeat(40));
  });

  it(
    'always tells the model what to RETURN — and since W13-09, in a shape it ' +
      'can actually produce rather than a phrase it has to guess at',
    () => {
      const rendered = renderHandoff(SAMPLE);
      expect(rendered).toContain('RETURN:');
      expect(rendered).toContain('```json');
      expect(rendered).toContain('"ticket": "W1-06"');
    },
  );

  it('renders an empty write-scope as an empty (never omitted) field', () => {
    const rendered = renderHandoff({ ...SAMPLE, writeScope: [] });
    expect(rendered).toContain('WRITE-SCOPE: \n');
  });
});

describe('renderHandoff redaction (SC-06)', () => {
  let tmpDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tmpDirs = [];
  });

  async function mkTmp(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-handoff-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  it('redacts a planted vault-registered and .env-sourced secret from context/produce/verify', async () => {
    const home = await mkTmp();
    const projectDir = await mkTmp();
    const vault = createProjectSecretsVault(createInMemoryCredentialStore(), projectDir, {
      DOKIMA_HOME: home,
    });
    await vault.register('forge-token', 'vault-planted-value');
    await fs.writeFile(path.join(projectDir, '.env'), 'DB_PASSWORD=env-planted-value\n');
    const secretValues = await collectSecretValues(vault, projectDir);

    const handoff: Handoff = {
      ...SAMPLE,
      context: 'connect using vault-planted-value then env-planted-value',
      produce: ['use vault-planted-value in the config'],
      verify: 'curl -H "Authorization: env-planted-value" https://example.test',
    };

    const rendered = renderHandoff(handoff, { secretValues });

    expect(rendered).not.toContain('vault-planted-value');
    expect(rendered).not.toContain('env-planted-value');
    expect(rendered).toContain('[REDACTED:secret]');
  });

  it('leaves context/produce/verify unredacted when no secretValues are supplied and no known pattern matches', () => {
    const rendered = renderHandoff(SAMPLE);
    expect(rendered).toContain(SAMPLE.context);
  });
});

/**
 * W13-09. Found by the first supervised run: on a local model the agent wrote
 * `subtract(a,b)` correctly, verified it to exit 0, and committed it — then
 * the loop auto-blocked twice with "no completion manifest returned" and
 * released the ticket. The manifest is parsed as strict JSON; the model was
 * asked for one in a single line of prose.
 */
describe('the handoff states the manifest contract (W13-09)', () => {
  const handoff: Handoff = {
    role: 'coding-agent',
    mission: 'Implement subtract',
    ticket: { id: 'T-1', title: 'Implement subtract(a, b) in src/math.mjs' },
    context: 'export function subtract(a: number, b: number): number',
    writeScope: ['src/**'],
    produce: ['subtract is exported and returns a - b'],
    verify: 'node src/check.mjs',
  };

  it(
    'RED FIXTURE: names every field the parser requires. It required ticket, ' +
      'files, commits, evidence and verify{command,exit}, and told the model ' +
      'none of them — "RETURN: Completion Manifest (files produced, verify ' +
      'result, evidence)" was the whole instruction',
    () => {
      const rendered = renderHandoff(handoff);
      for (const field of ['ticket', 'files', 'commits', 'evidence', 'verify', 'command', 'exit']) {
        expect(rendered, `contract does not mention "${field}"`).toContain(field);
      }
      expect(rendered).toMatch(/JSON/);
    },
  );

  it(
    'THE STRONGEST FIXTURE: the example in the prompt actually parses. A ' +
      'documented shape that the real parser rejects would be worse than no ' +
      'documentation — it would look right and fail the same way',
    () => {
      const rendered = renderHandoff(handoff);
      const fenced = /```json\n([\s\S]*?)```/.exec(rendered);
      expect(fenced, 'expected a fenced JSON example in the handoff').not.toBeNull();
      const { manifest } = parseCompletionManifest(fenced![1]!);
      expect(manifest).not.toBeNull();
      expect(manifest!.ticket).toBe('T-1');
      expect(manifest!.verify.command).toBe('node src/check.mjs');
    },
  );

  it("the example uses THIS ticket's id and verify command, not a placeholder", () => {
    const rendered = renderHandoff(handoff);
    expect(rendered).toContain('"ticket": "T-1"');
    expect(rendered).toContain('node src/check.mjs');
  });

  it(
    'still redacts secrets. The contract block is new prompt surface, and ' +
      'every other part of this render passes through redactDeep',
    () => {
      const rendered = renderHandoff(
        { ...handoff, verify: 'curl -H "token: sk-live-abc123" x' },
        { secretValues: ['sk-live-abc123'] },
      );
      expect(rendered).not.toContain('sk-live-abc123');
    },
  );
});
