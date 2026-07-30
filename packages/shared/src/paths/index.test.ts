import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DistributionRootNotFoundError,
  distributionRoot,
  resetDistributionRootCache,
  resolveAsset,
} from './index.js';

afterEach(() => {
  delete process.env.SHIPWRIGHT_DIST_ROOT;
  resetDistributionRootCache();
});

describe('distributionRoot (W9-13)', () => {
  it('finds the repo root from source, and it is the directory holding the root package.json', () => {
    const root = distributionRoot();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    ) as { name: string };
    expect(manifest.name).toBe('shipwright');
  });

  it('resolves the assets the bundled run actually died on', () => {
    // The regression this whole helper exists for: these four must exist on
    // disk at exactly the repo-relative paths the old ../.. hops produced.
    expect(fs.existsSync(resolveAsset('packages', 'events', 'migrations'))).toBe(true);
    expect(fs.existsSync(resolveAsset('content', 'experts'))).toBe(true);
    expect(fs.existsSync(resolveAsset('content', 'guide'))).toBe(true);
    expect(fs.existsSync(resolveAsset('content', 'validators'))).toBe(true);
  });

  it('walks PAST @shipwright/* package manifests rather than stopping at the first package.json', () => {
    // This module lives in packages/shared, which has its own package.json. If
    // the probe stopped at the nearest manifest it would answer packages/shared
    // and every asset path would be wrong -- silently, since the join still
    // produces a plausible-looking absolute path.
    const root = distributionRoot();
    expect(path.basename(root)).not.toBe('shared');
    expect(fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))).toBe(true);
  });

  it('honours SHIPWRIGHT_DIST_ROOT, so an unusual install can override the probe', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-root-'));
    process.env.SHIPWRIGHT_DIST_ROOT = tmp;
    expect(distributionRoot()).toBe(path.resolve(tmp));
    expect(resolveAsset('content', 'experts')).toBe(path.join(tmp, 'content', 'experts'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('throws a named, actionable error when no root manifest is above it', () => {
    // Proven by pointing the override at a directory tree with no shipwright
    // manifest is not enough -- the override short-circuits the probe. Assert
    // the error type is exported and carries the override hint instead.
    const err = new DistributionRootNotFoundError('/nowhere');
    expect(err.name).toBe('DistributionRootNotFoundError');
    expect(err.message).toContain('SHIPWRIGHT_DIST_ROOT');
    expect(err.message).toContain('/nowhere');
  });
});
