import { z } from 'zod';

/**
 * License field - can be any string, but isAllowlistedLicense() checks if it's
 * in the auto-accept list (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, first-party).
 * Anything else requires explicit approval (parks as a founder slate per R-E1).
 * The loader enforces deny-by-default: only allowlisted licenses are accepted.
 */
const LICENSE_SCHEMA = z.string();

export type License = string;

/**
 * A single file entry in the manifest with its hash.
 */
export const MANIFEST_FILE_ENTRY_SCHEMA = z.object({
  path: z.string().min(1),
  hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

export type ManifestFileEntry = z.infer<typeof MANIFEST_FILE_ENTRY_SCHEMA>;

/**
 * Pack manifest with file list, hashes, license, and publisher signature.
 * The signature is computed over the JSON representation of files, license, and version,
 * signed with the publisher's private key.
 */
export const MANIFEST_SCHEMA = z.object({
  version: z.literal(1),
  license: LICENSE_SCHEMA,
  files: z.array(MANIFEST_FILE_ENTRY_SCHEMA),
  signature: z.string().regex(/^[a-f0-9]{128}$/), // Ed25519 signature as hex (64 bytes = 128 hex chars)
  publisher: z.string(),
  signedAt: z.string().datetime(),
});

export type PackManifest = z.infer<typeof MANIFEST_SCHEMA>;

/**
 * The data that gets signed - excludes the signature field itself.
 */
export interface ManifestSigningData {
  version: number;
  license: License;
  files: ManifestFileEntry[];
  publisher: string;
  signedAt: string;
}

/**
 * Create the signing payload from manifest data.
 * This is the canonical form that gets hashed and signed.
 */
export function createManifestSigningPayload(data: ManifestSigningData): string {
  return JSON.stringify({
    version: data.version,
    license: data.license,
    files: data.files,
    publisher: data.publisher,
    signedAt: data.signedAt,
  });
}

/**
 * Check if a license is in the auto-accept list (MIT, Apache-2.0, BSD variants, or first-party).
 */
export function isAllowlistedLicense(license: License): boolean {
  return ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'first-party'].includes(
    license,
  );
}
