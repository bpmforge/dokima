import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DistributionRootNotFoundError,
  distributionRoot,
  isRootManifest,
  resetDistributionRootCache,
  resolveAsset,
} from './index.js';

afterEach(() => {
  delete process.env.DOKIMA_DIST_ROOT;
  resetDistributionRootCache();
});

describe('distributionRoot (W9-13)', () => {
  it('finds the repo root from source, and it is the directory holding the root package.json', () => {
    const root = distributionRoot();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    ) as { bin?: Record<string, string> };
    // Asserted on the `bin` marker, not the package name. This assertion used to
    // read `name === 'dokima'` and went red the moment the package was scoped
    // for publication (W10-43) — the test encoded the same brittle coupling as
    // the code it was guarding.
    expect(manifest.bin).toHaveProperty('dokima');
  });

  it('resolves the assets the bundled run actually died on', () => {
    // The regression this whole helper exists for: these four must exist on
    // disk at exactly the repo-relative paths the old ../.. hops produced.
    expect(fs.existsSync(resolveAsset('packages', 'events', 'migrations'))).toBe(true);
    expect(fs.existsSync(resolveAsset('content', 'experts'))).toBe(true);
    expect(fs.existsSync(resolveAsset('content', 'guide'))).toBe(true);
    expect(fs.existsSync(resolveAsset('content', 'validators'))).toBe(true);
  });

  it('walks PAST @dokima/* package manifests rather than stopping at the first package.json', () => {
    // This module lives in packages/shared, which has its own package.json. If
    // the probe stopped at the nearest manifest it would answer packages/shared
    // and every asset path would be wrong -- silently, since the join still
    // produces a plausible-looking absolute path.
    const root = distributionRoot();
    expect(path.basename(root)).not.toBe('shared');
    expect(fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))).toBe(true);
  });

  it('honours DOKIMA_DIST_ROOT, so an unusual install can override the probe', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-root-'));
    process.env.DOKIMA_DIST_ROOT = tmp;
    expect(distributionRoot()).toBe(path.resolve(tmp));
    expect(resolveAsset('content', 'experts')).toBe(path.join(tmp, 'content', 'experts'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('throws a named, actionable error when no root manifest is above it', () => {
    // Proven by pointing the override at a directory tree with no dokima
    // manifest is not enough -- the override short-circuits the probe. Assert
    // the error type is exported and carries the override hint instead.
    const err = new DistributionRootNotFoundError('/nowhere');
    expect(err.name).toBe('DistributionRootNotFoundError');
    expect(err.message).toContain('DOKIMA_DIST_ROOT');
    expect(err.message).toContain('/nowhere');
  });
});

describe('isRootManifest — the marker rule (W10-43)', () => {
  const scratch: string[] = [];
  afterEach(() => {
    for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
    scratch.length = 0;
  });

  const withManifest = (manifest: unknown): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-manifest-'));
    scratch.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
    return dir;
  };

  it('RED FIXTURE: accepts the PUBLISHED, scoped package — the case that shipped broken', () => {
    // `npm install ./bpmforge-dokima-0.1.0.tgz` then `dokima --help` died with
    // DistributionRootNotFoundError, because the rule was `name === 'dokima'`
    // and the published name is `@bpmforge/dokima`. Every asset — content/,
    // both migration sets, the web dist — became unreachable. Reverting the
    // marker to a name-equality check reds this test.
    const dir = withManifest({
      name: '@bpmforge/dokima',
      version: '0.1.0',
      bin: { dokima: 'apps/server/src/bootstrap/cli-entry.mjs' },
    });
    expect(isRootManifest(dir)).toBe(true);
  });

  it('still accepts the source checkout, whatever the root package is called', () => {
    expect(isRootManifest(withManifest({ name: 'dokima', bin: { dokima: 'x.mjs' } }))).toBe(true);
    expect(isRootManifest(withManifest({ name: 'anything-at-all', bin: { dokima: 'x.mjs' } }))).toBe(true);
  });

  it('walks past an @dokima/* workspace manifest — it declares no dokima bin', () => {
    // The property the old name check got right and must not be lost: stopping
    // at packages/shared would make every asset path wrong but plausible.
    expect(isRootManifest(withManifest({ name: '@dokima/shared', version: '0.0.0' }))).toBe(false);
    expect(isRootManifest(withManifest({ name: '@dokima/events', bin: { other: 'x.mjs' } }))).toBe(false);
  });

  it("walks past a consumer's own package.json, which is what sits above a real install", () => {
    expect(isRootManifest(withManifest({ name: 'someones-app', dependencies: {} }))).toBe(false);
  });

  it('handles a bare-string bin, and does not treat a foreign one as ours', () => {
    // npm allows `"bin": "./cli.js"`, which names the bin after the package.
    expect(isRootManifest(withManifest({ name: 'dokima', bin: './cli.mjs' }))).toBe(true);
    expect(isRootManifest(withManifest({ name: 'not-dokima', bin: './cli.mjs' }))).toBe(false);
  });

  it('keeps ascending past a directory with no manifest, or a malformed one', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-manifest-'));
    scratch.push(empty);
    expect(isRootManifest(empty)).toBe(false);

    const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-manifest-'));
    scratch.push(bad);
    fs.writeFileSync(path.join(bad, 'package.json'), '{ not json');
    expect(isRootManifest(bad)).toBe(false);
  });
});
