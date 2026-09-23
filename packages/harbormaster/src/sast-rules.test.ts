/**
 * W23-51 — the SAST ruleset is located on the host and pinned by content.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveSastRules, sastRulesLocation } from './sast-rules.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function tree(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-sast-rules-'));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), body);
  }
  return root;
}

describe('resolveSastRules', () => {
  it('DOKIMA_SAST_RULES wins; otherwise ~/.dokima/rules/sast under HOME', () => {
    expect(sastRulesLocation({ DOKIMA_SAST_RULES: '/x/packs', HOME: '/h' })).toEqual({
      dir: '/x/packs',
      fromEnv: true,
    });
    expect(sastRulesLocation({ HOME: '/h' })).toEqual({
      dir: path.join('/h', '.dokima', 'rules', 'sast'),
      fromEnv: false,
    });
  });

  it('a bpm-rulepacks-shaped packs/ dir contributes its SECURITY packs only', async () => {
    const root = await tree({
      'owasp/a.yaml': 'rules: []',
      'secrets/b.yaml': 'rules: []',
      'slop/c.yaml': 'rules: []',
      'house/d.yaml': 'rules: []',
    });
    const rules = await resolveSastRules({ DOKIMA_SAST_RULES: root });
    expect(rules?.configPaths).toEqual([
      path.join(root, 'owasp'),
      path.join(root, 'secrets'),
    ]);
    expect(rules?.ruleFileCount).toBe(2);
    expect(rules?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('any other rules directory is used whole', async () => {
    const root = await tree({ 'mine.yml': 'rules: []' });
    const rules = await resolveSastRules({ DOKIMA_SAST_RULES: root });
    expect(rules?.configPaths).toEqual([root]);
  });

  it('the digest pins content: editing one rule changes it', async () => {
    const root = await tree({ 'owasp/a.yaml': 'rules: []' });
    const before = (await resolveSastRules({ DOKIMA_SAST_RULES: root }))!.digest;
    await fs.writeFile(path.join(root, 'owasp/a.yaml'), 'rules: [x]');
    const after = (await resolveSastRules({ DOKIMA_SAST_RULES: root }))!.digest;
    expect(after).not.toBe(before);
  });

  it('a missing or empty directory is null — the check then reports NOT RUN', async () => {
    expect(
      await resolveSastRules({ DOKIMA_SAST_RULES: '/definitely/not/here' }),
    ).toBeNull();
    const empty = await tree({ 'README.md': 'no rules' });
    expect(await resolveSastRules({ DOKIMA_SAST_RULES: empty })).toBeNull();
  });
});
