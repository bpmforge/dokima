import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createAndSignManifest,
  generateKeyPair,
  hashFile,
  loadManifest,
  saveManifest,
  signManifest,
  verifyFileHash,
  verifyManifestFiles,
  verifyManifestSignature,
} from './signer.js';
import { type ManifestSigningData, type PackManifest } from './manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('signer', () => {
  let tempDir: string;
  let { publicKey, privateKey } = generateKeyPair();

  beforeEach(async () => {
    tempDir = path.join(
      __dirname,
      `../.test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
    ({ publicKey, privateKey } = generateKeyPair());
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('generateKeyPair', () => {
    it('generates an ed25519 key pair', () => {
      const { publicKey: pub, privateKey: priv } = generateKeyPair();
      expect(pub.asymmetricKeyType).toBe('ed25519');
      expect(priv.asymmetricKeyType).toBe('ed25519');
    });
  });

  describe('hashFile', () => {
    it('computes SHA256 hash of a file in sha256:hex format', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      const content = 'test content';
      await fs.writeFile(testFile, content);

      const hash = await hashFile(testFile);

      expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);

      const expectedHash = createHash('sha256').update(content).digest('hex');
      expect(hash).toBe(`sha256:${expectedHash}`);
    });

    it('returns different hashes for different file contents', async () => {
      const file1 = path.join(tempDir, 'file1.txt');
      const file2 = path.join(tempDir, 'file2.txt');
      await fs.writeFile(file1, 'content1');
      await fs.writeFile(file2, 'content2');

      const hash1 = await hashFile(file1);
      const hash2 = await hashFile(file2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('signManifest and verifyManifestSignature', () => {
    it('signs a manifest and verifies the signature', () => {
      const signingData: ManifestSigningData = {
        version: 1,
        license: 'MIT',
        files: [{ path: 'validate-test.sh', hash: 'sha256:abcd1234' }],
        publisher: 'test-publisher',
        signedAt: '2026-07-20T00:00:00Z',
      };

      const signature = signManifest(signingData, privateKey);

      const manifest: PackManifest = {
        version: 1,
        license: 'MIT',
        files: [{ path: 'validate-test.sh', hash: 'sha256:abcd1234' }],
        signature,
        publisher: 'test-publisher',
        signedAt: '2026-07-20T00:00:00Z',
      };

      expect(verifyManifestSignature(manifest, publicKey)).toBe(true);
    });

    it('rejects a signature from a different key', () => {
      const signingData: ManifestSigningData = {
        version: 1,
        license: 'MIT',
        files: [{ path: 'validate-test.sh', hash: 'sha256:abcd1234' }],
        publisher: 'test-publisher',
        signedAt: '2026-07-20T00:00:00Z',
      };

      const signature = signManifest(signingData, privateKey);

      const manifest: PackManifest = {
        version: 1,
        license: 'MIT',
        files: [{ path: 'validate-test.sh', hash: 'sha256:abcd1234' }],
        signature,
        publisher: 'test-publisher',
        signedAt: '2026-07-20T00:00:00Z',
      };

      const { publicKey: otherPublicKey } = generateKeyPair();
      expect(verifyManifestSignature(manifest, otherPublicKey)).toBe(false);
    });

    it('rejects a tampered manifest', () => {
      const signingData: ManifestSigningData = {
        version: 1,
        license: 'MIT',
        files: [{ path: 'validate-test.sh', hash: 'sha256:abcd1234' }],
        publisher: 'test-publisher',
        signedAt: '2026-07-20T00:00:00Z',
      };

      const signature = signManifest(signingData, privateKey);

      const manifest: PackManifest = {
        version: 1,
        license: 'MIT',
        files: [{ path: 'validate-test.sh', hash: 'sha256:tampered' }], // changed file hash
        signature,
        publisher: 'test-publisher',
        signedAt: '2026-07-20T00:00:00Z',
      };

      expect(verifyManifestSignature(manifest, publicKey)).toBe(false);
    });
  });

  describe('verifyFileHash', () => {
    it('verifies that a file matches its hash', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      const content = 'test content';
      await fs.writeFile(testFile, content);

      const hash = await hashFile(testFile);

      const isValid = await verifyFileHash(testFile, hash);
      expect(isValid).toBe(true);
    });

    it('rejects a file with a mismatched hash', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'content');

      const wrongHash = 'sha256:' + 'a'.repeat(64);

      const isValid = await verifyFileHash(testFile, wrongHash);
      expect(isValid).toBe(false);
    });
  });

  describe('verifyManifestFiles', () => {
    it('verifies all files in a manifest', async () => {
      const file1 = path.join(tempDir, 'validate-test1.sh');
      const file2 = path.join(tempDir, 'validate-test2.sh');
      await fs.writeFile(file1, 'content1');
      await fs.writeFile(file2, 'content2');

      const hash1 = await hashFile(file1);
      const hash2 = await hashFile(file2);

      const manifest: PackManifest = {
        version: 1,
        license: 'MIT',
        files: [
          { path: 'validate-test1.sh', hash: hash1 },
          { path: 'validate-test2.sh', hash: hash2 },
        ],
        signature: '0'.repeat(128),
        publisher: 'test',
        signedAt: '2026-07-20T00:00:00Z',
      };

      const mismatches = await verifyManifestFiles(manifest, tempDir);
      expect(mismatches).toHaveLength(0);
    });

    it('detects files with mismatched hashes', async () => {
      const file1 = path.join(tempDir, 'validate-test1.sh');
      const file2 = path.join(tempDir, 'validate-test2.sh');
      await fs.writeFile(file1, 'content1');
      await fs.writeFile(file2, 'content2');

      const manifest: PackManifest = {
        version: 1,
        license: 'MIT',
        files: [
          { path: 'validate-test1.sh', hash: 'sha256:' + 'a'.repeat(64) },
          { path: 'validate-test2.sh', hash: 'sha256:' + 'b'.repeat(64) },
        ],
        signature: '0'.repeat(128),
        publisher: 'test',
        signedAt: '2026-07-20T00:00:00Z',
      };

      const mismatches = await verifyManifestFiles(manifest, tempDir);
      expect(mismatches).toEqual(['validate-test1.sh', 'validate-test2.sh']);
    });
  });

  describe('createAndSignManifest', () => {
    it('creates and signs a manifest for a directory', async () => {
      const file1 = path.join(tempDir, 'validate-test1.sh');
      const file2 = path.join(tempDir, 'validate-test2.sh');
      await fs.writeFile(file1, 'content1');
      await fs.writeFile(file2, 'content2');

      const manifest = await createAndSignManifest(
        tempDir,
        'MIT',
        'test-publisher',
        privateKey,
        publicKey,
      );

      expect(manifest.version).toBe(1);
      expect(manifest.license).toBe('MIT');
      expect(manifest.publisher).toBe('test-publisher');
      expect(manifest.files).toHaveLength(2);
      expect(manifest.files.map((f) => f.path).sort()).toEqual([
        'validate-test1.sh',
        'validate-test2.sh',
      ]);
      expect(manifest.signature).toMatch(/^[a-f0-9]{128}$/);

      // Verify signature is correct
      expect(verifyManifestSignature(manifest, publicKey)).toBe(true);
    });

    it('discovers files matching the validator naming pattern', async () => {
      const valid = ['validate-test.sh', 'run-test.sh', 'secrets-scan.sh'];
      const invalid = ['_lib.sh', 'test.txt', 'readme.md'];

      for (const file of valid) {
        await fs.writeFile(path.join(tempDir, file), 'content');
      }
      for (const file of invalid) {
        await fs.writeFile(path.join(tempDir, file), 'content');
      }

      const manifest = await createAndSignManifest(
        tempDir,
        'MIT',
        'test',
        privateKey,
        publicKey,
      );

      expect(manifest.files.map((f) => f.path).sort()).toEqual(valid.sort());
    });
  });

  describe('loadManifest and saveManifest', () => {
    it('saves and loads a manifest', async () => {
      const originalManifest: PackManifest = {
        version: 1,
        license: 'Apache-2.0',
        files: [{ path: 'validate-test.sh', hash: 'sha256:' + 'a'.repeat(64) }],
        signature: 'a'.repeat(128),
        publisher: 'test-publisher',
        signedAt: '2026-07-20T12:00:00Z',
      };

      const manifestPath = path.join(tempDir, 'manifest.json');
      await saveManifest(originalManifest, manifestPath);

      const loaded = await loadManifest(manifestPath);
      expect(loaded).toEqual(originalManifest);
    });
  });
});
