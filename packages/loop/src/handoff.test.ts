import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectSecretValues,
  createInMemoryCredentialStore,
  createProjectSecretsVault,
} from '@shipwright/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { renderHandoff, type Handoff } from './handoff.js';

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
  it('renders the exact universal block format from BLUEPRINT §4', () => {
    expect(renderHandoff(SAMPLE)).toBe(
      [
        '════════════════════════════════════════',
        'ROLE: coding-agent — implement the ticket',
        'TICKET: W1-06 HANDOFF contract + agent session runner',
        'CONTEXT: relevant docs, interfaces, prior findings',
        'WRITE-SCOPE: packages/loop/src/handoff*, packages/loop/src/session*',
        'PRODUCE: acceptance criterion 1; acceptance criterion 2',
        'VERIFY: pnpm test --filter loop',
        'RETURN: Completion Manifest (files produced, verify result, evidence)',
        '════════════════════════════════════════',
      ].join('\n'),
    );
  });

  it('opens and closes with a 40-character rule, matching the BLUEPRINT literal', () => {
    const lines = renderHandoff(SAMPLE).split('\n');
    expect(lines[0]).toBe('═'.repeat(40));
    expect(lines[lines.length - 1]).toBe('═'.repeat(40));
  });

  it('always names Completion Manifest on the RETURN line', () => {
    expect(renderHandoff(SAMPLE)).toContain(
      'RETURN: Completion Manifest (files produced, verify result, evidence)',
    );
  });

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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-handoff-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  it('redacts a planted vault-registered and .env-sourced secret from context/produce/verify', async () => {
    const home = await mkTmp();
    const projectDir = await mkTmp();
    const vault = createProjectSecretsVault(createInMemoryCredentialStore(), projectDir, {
      SHIPWRIGHT_HOME: home,
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
