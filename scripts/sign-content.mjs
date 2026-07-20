#!/usr/bin/env node

/**
 * Sign the first-party content pack.
 *
 * Usage: node scripts/sign-content.mjs [--generate-key]
 *
 * This script creates or updates content/manifest.json with:
 * - File list with SHA256 hashes
 * - Publisher signature using Ed25519
 * - License field (first-party for first-party content)
 *
 * The public key is committed to the repo; the private key should be
 * kept secure and loaded from an environment variable or keychain.
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
const KEY_DIR = path.join(repoRoot, '.keys');
const PUBLIC_KEY_PATH = path.join(KEY_DIR, 'shipwright-public.pem');
const PRIVATE_KEY_PATH = path.join(KEY_DIR, 'shipwright-private.pem');

/**
 * Generate Ed25519 key pair and save to files.
 */
async function generateAndSaveKeyPair() {
  console.log('Generating Ed25519 key pair...');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

  await fs.mkdir(KEY_DIR, { recursive: true });
  await fs.writeFile(PUBLIC_KEY_PATH, publicKeyPem, { mode: 0o644 });
  await fs.writeFile(PRIVATE_KEY_PATH, privateKeyPem, { mode: 0o600 });

  console.log(`✓ Generated and saved key pair to ${KEY_DIR}`);
  console.log(`  Public key (can be committed): ${PUBLIC_KEY_PATH}`);
  console.log(`  Private key (keep secret): ${PRIVATE_KEY_PATH}`);
}

/**
 * Load keys from PEM files.
 */
async function loadKeyPair() {
  const publicKeyPem = await fs.readFile(PUBLIC_KEY_PATH, 'utf-8');
  const privateKeyPem = await fs.readFile(PRIVATE_KEY_PATH, 'utf-8');

  const publicKey = crypto.createPublicKey({
    key: publicKeyPem,
    format: 'pem',
  });

  const privateKey = crypto.createPrivateKey({
    key: privateKeyPem,
    format: 'pem',
  });

  return { publicKey, privateKey };
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
  // Check if keys exist, generate if not
  try {
    await fs.stat(PUBLIC_KEY_PATH);
    await fs.stat(PRIVATE_KEY_PATH);
  } catch {
    console.log('Keys not found, generating...');
    await generateAndSaveKeyPair();
  }

  const { publicKey, privateKey } = await loadKeyPair();

  console.log('Scanning validators directory...');
  const entries = await fs.readdir(CONTENT_DIR, { withFileTypes: true });
  const VALIDATOR_NAME_RE = /^(?:(?:validate|run)-.+|secrets-scan)\.sh$/;

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
    publisher: 'shipwright',
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
    publisher: 'shipwright',
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

// Parse command-line arguments
const args = process.argv.slice(2);
if (args.includes('--generate-key')) {
  generateAndSaveKeyPair()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error generating keys:', err);
      process.exit(1);
    });
} else {
  signContent()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error signing content:', err);
      process.exit(1);
    });
}
