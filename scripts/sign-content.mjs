#!/usr/bin/env node

/**
 * Sign the first-party content pack.
 *
 * Usage: DOKIMA_SIGNING_KEY="..." node scripts/sign-content.mjs
 *
 * This script creates or updates content/manifest.json with:
 * - File list with SHA256 hashes
 * - Publisher signature using Ed25519
 * - License field (first-party for first-party content)
 *
 * The public key is committed to content/keys/dokima-public.pem.
 * The private key must be provided via DOKIMA_SIGNING_KEY environment variable
 * (PEM format or base64-encoded). Never commit the private key to the repo.
 */

import { createHash } from 'node:crypto';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const CONTENT_DIR = path.join(repoRoot, 'content', 'validators');
const MANIFEST_PATH = path.join(repoRoot, 'content', 'manifest.json');
const PUBLIC_KEY_PATH = path.join(repoRoot, 'content', 'keys', 'dokima-public.pem');

/**
 * Load the private key from DOKIMA_SIGNING_KEY environment variable.
 * The key can be in PEM format or base64-encoded.
 */
function loadPrivateKeyFromEnv() {
  const keyData = process.env.DOKIMA_SIGNING_KEY;
  if (!keyData) {
    throw new Error(
      'DOKIMA_SIGNING_KEY environment variable is not set. ' +
      'Provide the Ed25519 private key in PEM format or base64-encoded.',
    );
  }

  let keyContent = keyData;
  // If it looks like base64 (no newlines, no dashes), decode it
  if (!keyData.includes('\n') && !keyData.includes('-----')) {
    try {
      keyContent = Buffer.from(keyData, 'base64').toString('utf-8');
    } catch {
      // If decoding fails, treat it as PEM
      keyContent = keyData;
    }
  }

  return crypto.createPrivateKey({
    key: keyContent,
    format: 'pem',
  });
}

/**
 * Load the public key from the committed file.
 */
async function loadPublicKey() {
  const publicKeyPem = await fs.readFile(PUBLIC_KEY_PATH, 'utf-8');
  return crypto.createPublicKey({
    key: publicKeyPem,
    format: 'pem',
  });
}

/**
 * Compute SHA256 hash of a file.
 */
async function hashFile(filePath) {
  const content = await fs.readFile(filePath);
  const hash = createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

/**
 * Create and sign the manifest.
 */
async function signContent() {
  // Load keys
  let privateKey;
  try {
    privateKey = loadPrivateKeyFromEnv();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  let publicKey;
  try {
    publicKey = await loadPublicKey();
  } catch (error) {
    console.error(`Error reading public key from ${PUBLIC_KEY_PATH}:`, error);
    process.exit(1);
  }

  console.log('Scanning validators directory...');
  const entries = await fs.readdir(CONTENT_DIR, { withFileTypes: true });
  // W10-52: `_lib*.sh` MUST be in this set. It is not a naming nicety — it is
  // what makes the shipped pack runnable at all.
  //
  // `packsUpdate` installs exactly the files this manifest names. This regex
  // used to be the pack-DISCOVERY pattern only, so the shared libraries every
  // validator sources were never signed and therefore never installed: a real
  // install landed 81 validators and zero libraries, and executing any one of
  // them exited 127 with `_lib.sh: No such file or directory`. Nothing caught
  // it because the repo runs validators from content/validators/ in the source
  // tree, where the libraries sit beside them.
  //
  // Signing them is independently correct: they are executable content the
  // product runs, and an attacker who could write `_lib.sh` controlled all 81
  // validators while every signature still verified.
  const VALIDATOR_NAME_RE = /^(?:(?:validate|run)-.+|secrets-scan|_lib.*)\.sh$/;

  const files = [];
  for (const entry of entries) {
    if (entry.isFile() && VALIDATOR_NAME_RE.test(entry.name)) {
      const filePath = path.join(CONTENT_DIR, entry.name);
      const hash = await hashFile(filePath);
      files.push({
        path: entry.name,
        hash,
      });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  console.log(`Found ${files.length} validators`);

  // Create signing payload
  const signedAt = new Date().toISOString();
  const signingData = {
    version: 1,
    license: 'first-party',
    files,
    publisher: 'dokima',
    signedAt,
  };

  // Sign the payload
  const payload = JSON.stringify({
    version: signingData.version,
    license: signingData.license,
    files: signingData.files,
    publisher: signingData.publisher,
    signedAt: signingData.signedAt,
  });

  const signature = crypto.sign(null, Buffer.from(payload), privateKey);

  // Create manifest
  const manifest = {
    version: 1,
    license: 'first-party',
    files,
    signature: signature.toString('hex'),
    publisher: 'dokima',
    signedAt,
  };

  // Verify signature
  const verified = crypto.verify(null, Buffer.from(payload), publicKey, signature);
  if (!verified) {
    throw new Error('Failed to verify manifest signature');
  }

  // Save manifest
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`✓ Signed and saved manifest to ${MANIFEST_PATH}`);
}

signContent()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error signing content:', err);
    process.exit(1);
  });
