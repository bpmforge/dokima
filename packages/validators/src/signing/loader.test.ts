import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createAndSignManifest,
  generateKeyPair,
  hashFile,
  saveManifest,
  signManifest,
} from './signer.js';
import { loadSignedPack, loadValidatorPackWithFallback } from './loader.js';
import { type ManifestSigningData, type PackManifest } from './manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('loader', () => {
  let tempDir: string;
  let manifestPath: string;
  let contentDir: string;
  let { publicKey, privateKey } = generateKeyPair();

  beforeEach(async () => {
    tempDir = path.join(
      __dirname,
      `../.test-loader-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    contentDir = path.join(tempDir, 'validators');
    manifestPath = path.join(tempDir, 'manifest.json');

    await fs.mkdir(contentDir, { recursive: true });
    ({ publicKey, privateKey } = generateKeyPair());
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('loadSignedPack', () => {
    it('loads a valid signed pack with allowlisted license', async () => {
      const file1 = path.join(contentDir, 'validate-test1.sh');
      const file2 = path.join(contentDir, 'validate-test2.sh');
      await fs.writeFile(file1, 'content1');
      await fs.writeFile(file2, 'content2');

      const manifest = await createAndSignManifest(
        contentDir,
        'MIT',
        'shipwright',
        privateKey,
        publicKey,
      );
      await saveManifest(manifest, manifestPath);

      const result = await loadSignedPack(manifestPath, contentDir, publicKey);

      expect(result.specs).toHaveLength(2);
      expect(result.specs.map((s) => s.name).sort()).toEqual([
        'validate-test1',
        'validate-test2',
      ]);
      expect(result.rejected).toHaveLength(0);
      expect(result.manifest).toBeDefined();
    });

    it('loads a valid signed pack with all allowlisted licenses', async () => {
      const licenses: (
        'MIT' | 'Apache-2.0' | 'BSD-2-Clause' | 'BSD-3-Clause' | 'first-party'
      )[] = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'first-party'];

      for (const license of licenses) {
        const file = path.join(contentDir, 'validate-test.sh');
        await fs.writeFile(file, `content-${license}`);

        const manifest = await createAndSignManifest(
          contentDir,
          license,
          'shipwright',
          privateKey,
          publicKey,
        );
        await saveManifest(manifest, manifestPath);

        const result = await loadSignedPack(manifestPath, contentDir, publicKey);

        expect(result.specs).toHaveLength(1);
        expect(result.rejected).toHaveLength(0);

        await fs.rm(file);
      }
    });

    describe('RED FIXTURE: deny-by-default license gating', () => {
      it('MUST reject all validators when license is not allowlisted (GPL)', async () => {
        const file1 = path.join(contentDir, 'validate-test1.sh');
        const file2 = path.join(contentDir, 'validate-test2.sh');
        await fs.writeFile(file1, 'content1');
        await fs.writeFile(file2, 'content2');

        const hash1 = await hashFile(file1);
        const hash2 = await hashFile(file2);

        // Create manifest with GPL license (not allowlisted)
        const license = 'GPL-3.0';
        const signingData: Omit<ManifestSigningData, 'license'> & { license: string } = {
          version: 1,
          license,
          files: [
            { path: 'validate-test1.sh', hash: hash1 },
            { path: 'validate-test2.sh', hash: hash2 },
          ],
          publisher: 'shipwright',
          signedAt: new Date().toISOString(),
        };

        const signature = signManifest(signingData as ManifestSigningData, privateKey);
        const manifest: Omit<PackManifest, 'license'> & { license: string } = {
          version: 1,
          license,
          files: signingData.files,
          signature,
          publisher: 'shipwright',
          signedAt: signingData.signedAt,
        };

        await saveManifest(manifest as PackManifest, manifestPath);

        const result = await loadSignedPack(manifestPath, contentDir, publicKey);

        // CRITICAL SECURITY: No validators must be in specs
        expect(result.specs).toHaveLength(0);
        expect(result.rejected).toHaveLength(2);
        expect(result.rejected[0]!.reason).toBe('license-not-allowlisted');
        expect(result.rejected[1]!.reason).toBe('license-not-allowlisted');
      });

      it('MUST reject all validators when license is not allowlisted (AGPL)', async () => {
        const file = path.join(contentDir, 'validate-test.sh');
        await fs.writeFile(file, 'content');
        const hash = await hashFile(file);

        const license = 'AGPL-3.0';
        const signingData: Omit<ManifestSigningData, 'license'> & { license: string } = {
          version: 1,
          license,
          files: [{ path: 'validate-test.sh', hash }],
          publisher: 'shipwright',
          signedAt: new Date().toISOString(),
        };

        const signature = signManifest(signingData as ManifestSigningData, privateKey);
        const manifest: Omit<PackManifest, 'license'> & { license: string } = {
          version: 1,
          license,
          files: signingData.files,
          signature,
          publisher: 'shipwright',
          signedAt: signingData.signedAt,
        };

        await saveManifest(manifest as PackManifest, manifestPath);

        const result = await loadSignedPack(manifestPath, contentDir, publicKey);

        expect(result.specs).toHaveLength(0);
        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0]!.reason).toBe('license-not-allowlisted');
      });

      it('MUST reject all validators when manifest signature verification fails', async () => {
        const file1 = path.join(contentDir, 'validate-test1.sh');
        const file2 = path.join(contentDir, 'validate-test2.sh');
        await fs.writeFile(file1, 'content1');
        await fs.writeFile(file2, 'content2');

        const hash1 = await hashFile(file1);
        const hash2 = await hashFile(file2);

        // Create manifest with a fake signature (wrong key)
        const manifest: PackManifest = {
          version: 1,
          license: 'MIT',
          files: [
            { path: 'validate-test1.sh', hash: hash1 },
            { path: 'validate-test2.sh', hash: hash2 },
          ],
          signature: '0'.repeat(128), // Fake signature (all zeros)
          publisher: 'shipwright',
          signedAt: new Date().toISOString(),
        };

        await saveManifest(manifest, manifestPath);

        const result = await loadSignedPack(manifestPath, contentDir, publicKey);

        // CRITICAL SECURITY: No validators must be in specs
        expect(result.specs).toHaveLength(0);
        expect(result.rejected).toHaveLength(2);
        expect(result.rejected[0]!.reason).toBe('signature-verification-failed');
        expect(result.rejected[1]!.reason).toBe('signature-verification-failed');
      });

      it('MUST reject all validators when file hash mismatches manifest', async () => {
        const file1 = path.join(contentDir, 'validate-test1.sh');
        const file2 = path.join(contentDir, 'validate-test2.sh');
        await fs.writeFile(file1, 'content1');
        await fs.writeFile(file2, 'content2');

        // Create manifest with wrong hashes
        const signingData: ManifestSigningData = {
          version: 1,
          license: 'MIT',
          files: [
            { path: 'validate-test1.sh', hash: 'sha256:' + 'a'.repeat(64) },
            { path: 'validate-test2.sh', hash: 'sha256:' + 'b'.repeat(64) },
          ],
          publisher: 'shipwright',
          signedAt: new Date().toISOString(),
        };

        const signature = signManifest(signingData, privateKey);
        const manifest: PackManifest = {
          version: 1,
          license: 'MIT',
          files: signingData.files,
          signature,
          publisher: 'shipwright',
          signedAt: signingData.signedAt,
        };

        await saveManifest(manifest, manifestPath);

        const result = await loadSignedPack(manifestPath, contentDir, publicKey);

        // CRITICAL SECURITY: No validators must be in specs
        expect(result.specs).toHaveLength(0);
        expect(result.rejected).toHaveLength(2);
        expect(result.rejected[0]!.reason).toBe('file-hash-mismatch');
        expect(result.rejected[1]!.reason).toBe('file-hash-mismatch');
      });

      it('MUST reject all validators when any file is missing', async () => {
        const file1 = path.join(contentDir, 'validate-test1.sh');
        await fs.writeFile(file1, 'content1');

        const hash1 = await hashFile(file1);

        // Create manifest referencing two files but only create one
        const signingData: ManifestSigningData = {
          version: 1,
          license: 'MIT',
          files: [
            { path: 'validate-test1.sh', hash: hash1 },
            { path: 'validate-test-missing.sh', hash: 'sha256:' + 'c'.repeat(64) },
          ],
          publisher: 'shipwright',
          signedAt: new Date().toISOString(),
        };

        const signature = signManifest(signingData, privateKey);
        const manifest: PackManifest = {
          version: 1,
          license: 'MIT',
          files: signingData.files,
          signature,
          publisher: 'shipwright',
          signedAt: signingData.signedAt,
        };

        await saveManifest(manifest, manifestPath);

        const result = await loadSignedPack(manifestPath, contentDir, publicKey);

        // CRITICAL SECURITY: No validators must be in specs when ANY file mismatches
        expect(result.specs).toHaveLength(0);
        // Should have one rejection for the file that doesn't exist/mismatch
        expect(result.rejected.length).toBeGreaterThan(0);
        // At least one should be hash mismatch (the missing file)
        expect(result.rejected.some((r) => r.reason === 'file-hash-mismatch')).toBe(true);
      });
    });

    it('handles missing manifest file gracefully', async () => {
      const result = await loadSignedPack(manifestPath, contentDir, publicKey);

      expect(result.specs).toHaveLength(0);
      expect(result.rejected).toHaveLength(0);
      expect(result.manifest).toBeUndefined();
    });

    it('handles invalid manifest JSON gracefully', async () => {
      await fs.writeFile(manifestPath, 'invalid json {');

      const result = await loadSignedPack(manifestPath, contentDir, publicKey);

      expect(result.specs).toHaveLength(0);
      expect(result.rejected).toHaveLength(0);
      expect(result.manifest).toBeUndefined();
    });
  });

  describe('loadValidatorPackWithFallback', () => {
    it('loads a valid signed pack when manifest exists', async () => {
      const file = path.join(contentDir, 'validate-test.sh');
      await fs.writeFile(file, 'content');

      const manifest = await createAndSignManifest(
        contentDir,
        'MIT',
        'shipwright',
        privateKey,
        publicKey,
      );
      await saveManifest(manifest, manifestPath);

      const result = await loadValidatorPackWithFallback(
        contentDir,
        manifestPath,
        publicKey,
        false,
      );

      expect(result.specs).toHaveLength(1);
      expect(result.rejected).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('falls back to directory scanning when allowUnsigned is true', async () => {
      const file1 = path.join(contentDir, 'validate-test1.sh');
      const file2 = path.join(contentDir, 'validate-test2.sh');
      await fs.writeFile(file1, 'content1');
      await fs.writeFile(file2, 'content2');

      const result = await loadValidatorPackWithFallback(
        contentDir,
        undefined,
        undefined,
        true,
      );

      expect(result.specs).toHaveLength(2);
      expect(result.warnings.some((w) => w.includes('unsigned'))).toBe(true);
    });

    it('returns empty specs when manifest fails and allowUnsigned is false', async () => {
      const result = await loadValidatorPackWithFallback(
        contentDir,
        manifestPath,
        publicKey,
        false,
      );

      expect(result.specs).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
