import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSuppression,
  listSuppressions,
  reopenIfContextChanged,
} from './suppression-store.js';

async function tmpProjectDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-suppressions-'));
}

describe('suppression store', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('starts empty for a fresh project', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    expect(await listSuppressions(dir)).toEqual([]);
  });

  it('creates a justification-gated, human-signed suppression', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    const row = await createSuppression(dir, {
      fingerprint: 'fp-1',
      ruleId: 'R-01',
      justification: 'false_positive',
      signedBy: 'Bradford Matthews',
      contextKey: 'rule-v1:file-abc:dep-1.0.0',
    });
    expect(row).toMatchObject({
      fingerprint: 'fp-1',
      ruleId: 'R-01',
      justification: 'false_positive',
      signedBy: 'Bradford Matthews',
      status: 'active',
    });
    expect(await listSuppressions(dir)).toHaveLength(1);
  });

  it('auto-reopens when the context key no longer matches (FR-RL3)', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    const row = await createSuppression(dir, {
      fingerprint: 'fp-1',
      ruleId: 'R-01',
      justification: 'false_positive',
      signedBy: 'Bradford Matthews',
      contextKey: 'rule-v1:file-abc:dep-1.0.0',
    });
    const unchanged = await reopenIfContextChanged(
      dir,
      row.id,
      'rule-v1:file-abc:dep-1.0.0',
    );
    expect(unchanged?.status).toBe('active');

    const reopened = await reopenIfContextChanged(
      dir,
      row.id,
      'rule-v2:file-abc:dep-1.0.0',
    );
    expect(reopened?.status).toBe('reopened');
    expect(reopened?.reopenedAt).not.toBeNull();
  });
});
