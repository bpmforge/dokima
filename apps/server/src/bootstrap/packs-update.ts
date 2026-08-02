/**
 * `dokima packs update` (DEPLOYMENT.md §3, SC-09): re-verifies the
 * first-party content pack's signature + file hashes and (re)installs it
 * into `~/.dokima/packs/`.
 *
 * The real verification engine already exists — `packages/validators/src/
 * signing/{signer,loader}.ts` (built by W6-07) — but `@dokima/validators`
 * isn't a declared dependency of `@dokima/server`, and `apps/server/
 * package.json` is outside this ticket's write_scope to add it (the exact
 * wall W4-02/W4-08 document hitting for their own out-of-scope deps). This
 * hand-mirrors the same two primitives (Ed25519 manifest-signature verify,
 * SHA-256 per-file hash verify) directly against `node:crypto`/`node:fs` —
 * no new dependency needed — operating on the real, committed
 * `content/manifest.json` + `content/keys/dokima-public.pem`. HANDOFF:
 * once a future ticket can touch `apps/server/package.json`, replace this
 * with a direct `loadSignedPack` import instead of keeping two copies of
 * the verification logic in sync.
 */

import crypto from 'node:crypto';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { distributionRoot } from '@dokima/shared';

const ALLOWLISTED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'first-party',
]);

export interface ManifestFileEntry {
  path: string;
  hash: string;
}

export interface PackManifest {
  version: number;
  license: string;
  files: ManifestFileEntry[];
  signature: string;
  publisher: string;
  signedAt: string;
}

export interface RejectedFile {
  path: string;
  reason: 'file-hash-mismatch' | 'file-missing';
}

export interface VerifyPackResult {
  manifestValid: boolean;
  licenseAllowlisted: boolean;
  verifiedFiles: string[];
  rejectedFiles: RejectedFile[];
  manifest: PackManifest;
}

function isPackManifest(value: unknown): value is PackManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.version === 'number' &&
    typeof m.license === 'string' &&
    Array.isArray(m.files) &&
    typeof m.signature === 'string' &&
    typeof m.publisher === 'string' &&
    typeof m.signedAt === 'string'
  );
}

function signingPayload(manifest: PackManifest): string {
  return JSON.stringify({
    version: manifest.version,
    license: manifest.license,
    files: manifest.files,
    publisher: manifest.publisher,
    signedAt: manifest.signedAt,
  });
}

async function hashFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

export async function loadManifest(manifestPath: string): Promise<PackManifest> {
  const raw = await fs.readFile(manifestPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isPackManifest(parsed)) {
    throw new Error(`${manifestPath} is not a valid pack manifest`);
  }
  return parsed;
}

export function verifyManifestSignature(
  manifest: PackManifest,
  publicKeyPem: string,
): boolean {
  try {
    const publicKey = crypto.createPublicKey({ key: publicKeyPem, format: 'pem' });
    return crypto.verify(
      null,
      Buffer.from(signingPayload(manifest)),
      publicKey,
      Buffer.from(manifest.signature, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Loads the manifest, verifies its signature + every file hash + license,
 * and reports per-file results. Deny-by-default (matching W6-07's loader):
 * a signature failure rejects every file; a license that isn't allowlisted
 * leaves `verifiedFiles` empty even if every hash matched.
 */
export async function verifyPack(
  manifestPath: string,
  contentDir: string,
  publicKeyPath: string,
): Promise<VerifyPackResult> {
  const manifest = await loadManifest(manifestPath);
  const publicKeyPem = await fs.readFile(publicKeyPath, 'utf8');
  const manifestValid = verifyManifestSignature(manifest, publicKeyPem);
  const licenseAllowlisted = ALLOWLISTED_LICENSES.has(manifest.license);

  const verifiedFiles: string[] = [];
  const rejectedFiles: RejectedFile[] = [];
  if (manifestValid && licenseAllowlisted) {
    for (const entry of manifest.files) {
      const filePath = path.join(contentDir, entry.path);
      let actualHash: string;
      try {
        actualHash = await hashFile(filePath);
      } catch {
        rejectedFiles.push({ path: entry.path, reason: 'file-missing' });
        continue;
      }
      if (actualHash === entry.hash) {
        verifiedFiles.push(entry.path);
      } else {
        rejectedFiles.push({ path: entry.path, reason: 'file-hash-mismatch' });
      }
    }
  } else {
    rejectedFiles.push(
      ...manifest.files.map((f) => ({
        path: f.path,
        reason: 'file-hash-mismatch' as const,
      })),
    );
  }

  return { manifestValid, licenseAllowlisted, verifiedFiles, rejectedFiles, manifest };
}

export const FIRST_PARTY_PACK_NAME = 'first-party';

export function defaultFirstPartyPackSource(): {
  manifestPath: string;
  contentDir: string;
  publicKeyPath: string;
} {
  // Anchored to the distribution root so the shipped content pack is found
  // from a bundle as well as from source (W9-13).
  const repoRoot = distributionRoot();
  return {
    manifestPath: path.join(repoRoot, 'content', 'manifest.json'),
    contentDir: path.join(repoRoot, 'content', 'validators'),
    publicKeyPath: path.join(repoRoot, 'content', 'keys', 'dokima-public.pem'),
  };
}

export interface PacksUpdateResult extends VerifyPackResult {
  installedTo: string;
}

/**
 * Verifies the first-party pack and copies every file that passed into
 * `~/.dokima/packs/first-party/` (SC-09: only verified files are ever
 * installed — a failed file is skipped, not copied anyway and flagged).
 */
export async function packsUpdate(
  packsDir: string,
  source: {
    manifestPath: string;
    contentDir: string;
    publicKeyPath: string;
  } = defaultFirstPartyPackSource(),
): Promise<PacksUpdateResult> {
  const result = await verifyPack(
    source.manifestPath,
    source.contentDir,
    source.publicKeyPath,
  );
  const installDir = path.join(packsDir, FIRST_PARTY_PACK_NAME);
  await fs.mkdir(installDir, { recursive: true });

  for (const relPath of result.verifiedFiles) {
    const from = path.join(source.contentDir, relPath);
    const to = path.join(installDir, relPath);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }
  await fs.writeFile(
    path.join(installDir, 'manifest.json'),
    `${JSON.stringify(result.manifest, null, 2)}\n`,
  );

  return { ...result, installedTo: installDir };
}
