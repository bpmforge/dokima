import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultFirstPartyPackSource,
  packsUpdate,
  verifyManifestSignature,
  verifyPack,
  type PackManifest,
} from './packs-update.js';

describe('packs-update', () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-packs-'));
    scratchDirs.push(dir);
    return dir;
  }

  it('verifies the real committed first-party pack (content/manifest.json + public key)', async () => {
    const source = defaultFirstPartyPackSource();
    const result = await verifyPack(
      source.manifestPath,
      source.contentDir,
      source.publicKeyPath,
    );
    expect(result.manifestValid).toBe(true);
    expect(result.licenseAllowlisted).toBe(true);
    expect(result.rejectedFiles).toEqual([]);
    expect(result.verifiedFiles.length).toBe(result.manifest.files.length);
    expect(result.verifiedFiles.length).toBeGreaterThan(0);
  });

  it('packsUpdate installs every verified file into ~/.dokima/packs/first-party/', async () => {
    const home = await scratchDir();
    const packsDir = path.join(home, 'packs');
    const result = await packsUpdate(packsDir);
    expect(result.manifestValid).toBe(true);
    expect(result.installedTo).toBe(path.join(packsDir, 'first-party'));

    for (const relPath of result.verifiedFiles.slice(0, 3)) {
      await expect(
        fs.stat(path.join(result.installedTo, relPath)),
      ).resolves.toBeDefined();
    }
    await expect(
      fs.stat(path.join(result.installedTo, 'manifest.json')),
    ).resolves.toBeDefined();
  });

  it('rejects every file when the manifest signature does not verify (tampered-pack fixture)', async () => {
    const dir = await scratchDir();
    const contentDir = path.join(dir, 'content');
    await fs.mkdir(contentDir, { recursive: true });
    await fs.writeFile(
      path.join(contentDir, 'validate-example.sh'),
      '#!/bin/sh\necho ok\n',
    );

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const fileHash = `sha256:${crypto
      .createHash('sha256')
      .update(await fs.readFile(path.join(contentDir, 'validate-example.sh')))
      .digest('hex')}`;

    const manifestData = {
      version: 1,
      license: 'MIT',
      files: [{ path: 'validate-example.sh', hash: fileHash }],
      publisher: 'test',
      signedAt: new Date(2026, 0, 1).toISOString(),
    };
    const signature = crypto
      .sign(null, Buffer.from(JSON.stringify(manifestData)), privateKey)
      .toString('hex');
    const manifest: PackManifest = { ...manifestData, signature };

    // Sanity: the correctly-signed manifest verifies against its own key.
    expect(
      verifyManifestSignature(
        manifest,
        publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      ),
    ).toBe(true);

    const manifestPath = path.join(dir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const publicKeyPath = path.join(dir, 'public.pem');

    // A DIFFERENT keypair's public key stands in for "wrong publisher key" —
    // the manifest is well-formed but doesn't verify against this key.
    const wrongKeyPair = crypto.generateKeyPairSync('ed25519');
    await fs.writeFile(
      publicKeyPath,
      wrongKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    );

    const result = await verifyPack(manifestPath, contentDir, publicKeyPath);
    expect(result.manifestValid).toBe(false);
    expect(result.verifiedFiles).toEqual([]);
    expect(result.rejectedFiles).toHaveLength(1);
  });

  it('rejects a file whose content was tampered after signing (hash mismatch)', async () => {
    const dir = await scratchDir();
    const contentDir = path.join(dir, 'content');
    await fs.mkdir(contentDir, { recursive: true });
    const filePath = path.join(contentDir, 'validate-example.sh');
    await fs.writeFile(filePath, '#!/bin/sh\necho ok\n');

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const originalHash = `sha256:${crypto
      .createHash('sha256')
      .update(await fs.readFile(filePath))
      .digest('hex')}`;
    const manifestData = {
      version: 1,
      license: 'MIT',
      files: [{ path: 'validate-example.sh', hash: originalHash }],
      publisher: 'test',
      signedAt: new Date(2026, 0, 1).toISOString(),
    };
    const signature = crypto
      .sign(null, Buffer.from(JSON.stringify(manifestData)), privateKey)
      .toString('hex');
    const manifest: PackManifest = { ...manifestData, signature };

    const manifestPath = path.join(dir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const publicKeyPath = path.join(dir, 'public.pem');
    await fs.writeFile(
      publicKeyPath,
      publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    );

    // Tamper with the file AFTER signing — the signature still verifies
    // (it only covers the manifest itself), but the hash no longer matches.
    await fs.writeFile(filePath, '#!/bin/sh\necho pwned\n');

    const result = await verifyPack(manifestPath, contentDir, publicKeyPath);
    expect(result.manifestValid).toBe(true);
    expect(result.verifiedFiles).toEqual([]);
    expect(result.rejectedFiles).toEqual([
      { path: 'validate-example.sh', reason: 'file-hash-mismatch' },
    ]);
  });

  it('rejects every file when the license is not allowlisted', async () => {
    const dir = await scratchDir();
    const contentDir = path.join(dir, 'content');
    await fs.mkdir(contentDir, { recursive: true });
    const filePath = path.join(contentDir, 'validate-example.sh');
    await fs.writeFile(filePath, '#!/bin/sh\necho ok\n');

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const fileHash = `sha256:${crypto
      .createHash('sha256')
      .update(await fs.readFile(filePath))
      .digest('hex')}`;
    const manifestData = {
      version: 1,
      license: 'GPL-3.0',
      files: [{ path: 'validate-example.sh', hash: fileHash }],
      publisher: 'test',
      signedAt: new Date(2026, 0, 1).toISOString(),
    };
    const signature = crypto
      .sign(null, Buffer.from(JSON.stringify(manifestData)), privateKey)
      .toString('hex');
    const manifest: PackManifest = { ...manifestData, signature };

    const manifestPath = path.join(dir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const publicKeyPath = path.join(dir, 'public.pem');
    await fs.writeFile(
      publicKeyPath,
      publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    );

    const result = await verifyPack(manifestPath, contentDir, publicKeyPath);
    expect(result.manifestValid).toBe(true);
    expect(result.licenseAllowlisted).toBe(false);
    expect(result.verifiedFiles).toEqual([]);
  });
});

/**
 * W10-52. The gate that was missing, and the reason a completely broken pack
 * shipped verified.
 *
 * `packsUpdate` installs exactly the files `content/manifest.json` names, and
 * the signer's name pattern excluded `_lib*.sh` — so a real install landed 81
 * validators and zero shared libraries. Every installed validator sources
 * `_lib.sh`, so executing any of them exited **127**:
 *
 *     validate-adrs.sh: line 37: .../first-party/_lib.sh: No such file or directory
 *     validate-adrs.sh: line 39: validator_init: command not found
 *
 * The existing tests above all passed throughout. They verify signatures,
 * hashes and install counts — none of them ever RAN an installed validator, so
 * the pack could be fully verified, fully installed and entirely non-functional
 * at once. Counting files is not evidence they work.
 */
describe('an installed pack actually RUNS (W10-52)', () => {
  const scratchDirs: string[] = [];
  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });

  it('RED FIXTURE: an installed validator executes on its own 0/1/2 contract, not 127', async () => {
    const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-pack-run-'));
    scratchDirs.push(dest);
    const result = await packsUpdate(dest);
    expect(result.manifestValid).toBe(true);
    expect(result.rejectedFiles).toEqual([]);

    const installed = path.join(dest, 'first-party');
    const validator = path.join(installed, 'validate-adrs.sh');
    const run = spawnSync('bash', [validator, '.'], { encoding: 'utf8', cwd: os.tmpdir() });

    // 127 is "command not found" — the shape this bug produced. The validator
    // contract is 0 clean / 1 gaps / 2 error; anything else means it could not
    // start, which is what shipped.
    expect(run.status, `stderr: ${(run.stderr || '').slice(0, 300)}`).not.toBe(127);
    expect([0, 1, 2]).toContain(run.status);
    expect(run.stderr ?? '').not.toContain('No such file or directory');
    expect(run.stderr ?? '').not.toContain('command not found');
  });

  it('ships the shared libraries every validator sources, and they are covered by the signature', async () => {
    const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-pack-libs-'));
    scratchDirs.push(dest);
    const result = await packsUpdate(dest);

    // Present on disk after install…
    const installed = await fs.readdir(path.join(dest, 'first-party'));
    expect(installed).toContain('_lib.sh');
    // …and verified, not merely copied: an unsigned lib is one an attacker can
    // rewrite to control all 81 validators while every signature still passes.
    expect(result.verifiedFiles).toContain('_lib.sh');

    // Every installed validator that sources a lib must find it beside itself.
    const sourcing = installed.filter((f) => f.startsWith('validate-') || f.startsWith('run-'));
    expect(sourcing.length).toBeGreaterThan(50);
    const missingLib: string[] = [];
    for (const file of sourcing) {
      const body = await fs.readFile(path.join(dest, 'first-party', file), 'utf8');
      const needs = body.match(/source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/(_lib[\w.-]*\.sh)"/);
      const lib = needs?.[1];
      if (lib !== undefined && !installed.includes(lib)) missingLib.push(`${file} -> ${lib}`);
    }
    expect(missingLib).toEqual([]);
  });
});
