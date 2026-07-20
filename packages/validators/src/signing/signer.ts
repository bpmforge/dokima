import { createHash } from 'node:crypto';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type {
  License,
  ManifestFileEntry,
  ManifestSigningData,
  PackManifest,
} from './manifest.js';
import { MANIFEST_SCHEMA, createManifestSigningPayload } from './manifest.js';

/**
 * Generate an Ed25519 key pair for signing content packs.
 * Public key can be committed; private key must be kept secret.
 */
export function generateKeyPair(): {
  publicKey: crypto.KeyObject;
  privateKey: crypto.KeyObject;
} {
  return crypto.generateKeyPairSync('ed25519');
}

/**
 * Compute SHA256 hash of a file's contents.
 * Returns hash in format "sha256:<hex>".
 */
export async function hashFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  const hash = createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

/**
 * Sign a manifest with a private key.
 * Computes signature over the canonical signing payload.
 */
export function signManifest(
  signingData: ManifestSigningData,
  privateKey: crypto.KeyObject,
): string {
  const payload = createManifestSigningPayload(signingData);
  const signature = crypto.sign(null, Buffer.from(payload), privateKey);
  return signature.toString('hex');
}

/**
 * Verify a manifest's signature using a public key.
 * Returns true if signature is valid, false otherwise.
 */
export function verifyManifestSignature(
  manifest: PackManifest,
  publicKey: crypto.KeyObject,
): boolean {
  const signingData: ManifestSigningData = {
    version: manifest.version,
    license: manifest.license,
    files: manifest.files,
    publisher: manifest.publisher,
    signedAt: manifest.signedAt,
  };
  const payload = createManifestSigningPayload(signingData);
  try {
    return crypto.verify(
      null,
      Buffer.from(payload),
      publicKey,
      Buffer.from(manifest.signature, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Create and sign a manifest for a directory of files.
 * Discovers all files matching the validator naming pattern and computes their hashes.
 */
export async function createAndSignManifest(
  contentDir: string,
  license: License,
  publisher: string,
  privateKey: crypto.KeyObject,
  publicKey: crypto.KeyObject,
): Promise<PackManifest> {
  // Discover and hash all validator files
  const entries = await fs.readdir(contentDir, { withFileTypes: true });
  const VALIDATOR_NAME_RE = /^(?:(?:validate|run)-.+|secrets-scan)\.sh$/;

  const files: ManifestFileEntry[] = [];
  for (const entry of entries) {
    if (entry.isFile() && VALIDATOR_NAME_RE.test(entry.name)) {
      const filePath = path.join(contentDir, entry.name);
      const hash = await hashFile(filePath);
      files.push({
        path: entry.name,
        hash,
      });
    }
  }

  // Sort for deterministic ordering
  files.sort((a, b) => a.path.localeCompare(b.path));

  const signedAt = new Date().toISOString();
  const signingData: ManifestSigningData = {
    version: 1,
    license,
    files,
    publisher,
    signedAt,
  };

  const signature = signManifest(signingData, privateKey);

  const manifest: PackManifest = {
    version: 1,
    license,
    files,
    signature,
    publisher,
    signedAt,
  };

  // Validate the manifest schema
  const validated = MANIFEST_SCHEMA.parse(manifest);

  // Verify the signature was created correctly
  if (!verifyManifestSignature(validated, publicKey)) {
    throw new Error('Failed to verify manifest signature immediately after signing');
  }

  return validated;
}

/**
 * Load and parse a manifest file, validating its structure.
 */
export async function loadManifest(manifestPath: string): Promise<PackManifest> {
  const content = await fs.readFile(manifestPath, 'utf-8');
  const parsed = JSON.parse(content);
  return MANIFEST_SCHEMA.parse(parsed);
}

/**
 * Save a manifest to a file.
 */
export async function saveManifest(
  manifest: PackManifest,
  manifestPath: string,
): Promise<void> {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

/**
 * Verify that a file matches its manifest entry's hash.
 */
export async function verifyFileHash(
  filePath: string,
  expectedHash: string,
): Promise<boolean> {
  try {
    const actualHash = await hashFile(filePath);
    return actualHash === expectedHash;
  } catch {
    return false;
  }
}

/**
 * Verify all files in a manifest against the filesystem.
 * Returns a list of files that don't match their hashes.
 */
export async function verifyManifestFiles(
  manifest: PackManifest,
  contentDir: string,
): Promise<string[]> {
  const mismatches: string[] = [];

  for (const fileEntry of manifest.files) {
    const filePath = path.join(contentDir, fileEntry.path);
    const matches = await verifyFileHash(filePath, fileEntry.hash);
    if (!matches) {
      mismatches.push(fileEntry.path);
    }
  }

  return mismatches;
}
