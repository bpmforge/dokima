import crypto from 'node:crypto';
import path from 'node:path';

import type { ValidatorSpec } from '../run.js';
import { isAllowlistedLicense, type PackManifest } from './manifest.js';
import { loadManifest, verifyManifestFiles, verifyManifestSignature } from './signer.js';

/**
 * A validator that was rejected from loading with a reason.
 */
export interface RejectedValidator {
  name: string;
  reason:
    | 'signature-verification-failed'
    | 'file-hash-mismatch'
    | 'license-not-allowlisted'
    | 'unknown-error';
  details?: string;
}

/**
 * Result of loading a signed pack.
 * - specs: ONLY validators that passed ALL checks (signature, hashes, license)
 * - rejected: validators that failed checks, with reasons
 * - manifest: the validated manifest (or undefined if manifest loading failed)
 */
export interface LoadSignedPackResult {
  specs: ValidatorSpec[];
  rejected: RejectedValidator[];
  manifest?: PackManifest;
}

/**
 * Load a signed content pack with deny-by-default security enforcement.
 *
 * This function:
 * 1. Loads and validates the manifest
 * 2. Verifies the manifest signature using the publisher's public key
 * 3. Verifies all file hashes match the manifest
 * 4. Checks that the license is allowlisted (MIT, Apache-2.0, BSD*, or first-party)
 * 5. Returns validators ONLY for entries that pass ALL checks
 * 6. Returns rejected entries separately with detailed reasons
 *
 * CRITICAL: result.specs MUST NEVER include any validator whose signature, hashes,
 * or license do not verify. Rejected validators are completely excluded from specs.
 *
 * @param manifestPath - Path to the manifest.json file
 * @param contentDir - Directory containing the validator executables
 * @param publisherPublicKey - Ed25519 public key to verify the signature
 * @returns Result with validated specs and list of rejected validators
 */
export async function loadSignedPack(
  manifestPath: string,
  contentDir: string,
  publisherPublicKey: crypto.KeyObject,
): Promise<LoadSignedPackResult> {
  const rejected: RejectedValidator[] = [];
  let manifest: PackManifest | undefined;

  // Step 1: Load and validate manifest structure
  try {
    manifest = await loadManifest(manifestPath);
  } catch {
    return {
      specs: [],
      rejected: [],
      manifest: undefined,
    };
  }

  // Step 2: Verify the manifest signature
  if (!verifyManifestSignature(manifest, publisherPublicKey)) {
    // Manifest signature verification failed - reject all validators
    for (const fileEntry of manifest.files) {
      rejected.push({
        name: fileEntry.path.replace(/\.sh$/, ''),
        reason: 'signature-verification-failed',
        details: 'Manifest signature does not verify with the publisher public key',
      });
    }
    return {
      specs: [],
      rejected,
      manifest,
    };
  }

  // Step 3: Verify the license is allowlisted
  if (!isAllowlistedLicense(manifest.license)) {
    // License is not allowlisted - reject all validators
    for (const fileEntry of manifest.files) {
      rejected.push({
        name: fileEntry.path.replace(/\.sh$/, ''),
        reason: 'license-not-allowlisted',
        details: `License "${manifest.license}" is not in the allowlist (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, first-party)`,
      });
    }
    return {
      specs: [],
      rejected,
      manifest,
    };
  }

  // Step 4: Verify all file hashes
  const fileMismatches = await verifyManifestFiles(manifest, contentDir);
  if (fileMismatches.length > 0) {
    // Some files don't match their hashes - reject all validators
    for (const fileEntry of manifest.files) {
      if (fileMismatches.includes(fileEntry.path)) {
        rejected.push({
          name: fileEntry.path.replace(/\.sh$/, ''),
          reason: 'file-hash-mismatch',
          details: `File hash does not match manifest entry for ${fileEntry.path}`,
        });
      }
    }
    return {
      specs: [],
      rejected,
      manifest,
    };
  }

  // Step 5: All checks passed - populate specs only with verified entries
  const specs: ValidatorSpec[] = manifest.files.map((fileEntry) => ({
    name: fileEntry.path.replace(/\.sh$/, ''),
    path: path.join(contentDir, fileEntry.path),
  }));

  return {
    specs,
    rejected,
    manifest,
  };
}

/**
 * Load a content pack with an option to allow unsigned packs (with a warning).
 * This is for legacy/fallback scenarios where a manifest doesn't exist.
 *
 * @param contentDir - Directory to discover validator executables in
 * @param manifestPath - Optional path to manifest.json
 * @param publisherPublicKey - Public key for signature verification
 * @param allowUnsigned - If true, fall back to directory scanning if manifest is missing
 * @returns Result with specs and list of warnings/rejected entries
 */
export async function loadValidatorPackWithFallback(
  contentDir: string,
  manifestPath?: string,
  publisherPublicKey?: crypto.KeyObject,
  allowUnsigned: boolean = false,
): Promise<LoadSignedPackResult & { warnings: string[] }> {
  const warnings: string[] = [];

  // Try to load signed manifest first
  if (manifestPath && publisherPublicKey) {
    try {
      const result = await loadSignedPack(manifestPath, contentDir, publisherPublicKey);
      if (result.specs.length > 0) {
        return {
          ...result,
          warnings,
        };
      }
      // If manifest was found but all validators rejected, still return the signed result
      if (result.manifest) {
        return {
          ...result,
          warnings,
        };
      }
    } catch (error) {
      if (allowUnsigned) {
        warnings.push(
          `Failed to load signed manifest: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      } else {
        throw error;
      }
    }
  }

  // Fallback: directory scan only if allowUnsigned is true
  if (allowUnsigned) {
    warnings.push('Loading unsigned content pack - signature verification skipped');
    const entries = await import('node:fs').then((fs) =>
      fs.promises.readdir(contentDir, { withFileTypes: true }),
    );
    const VALIDATOR_NAME_RE = /^(?:(?:validate|run)-.+|secrets-scan)\.sh$/;

    const specs: ValidatorSpec[] = entries
      .filter((entry) => entry.isFile() && VALIDATOR_NAME_RE.test(entry.name))
      .map((entry) => ({
        name: entry.name.replace(/\.sh$/, ''),
        path: path.join(contentDir, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      specs,
      rejected: [],
      warnings,
    };
  }

  // No manifest, no fallback
  return {
    specs: [],
    rejected: [],
    warnings,
  };
}
