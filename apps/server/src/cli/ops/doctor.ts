/**
 * `dokima doctor` (DEPLOYMENT.md §8): port free, DB integrity
 * (`PRAGMA integrity_check` + audit tail check), keychain reachable,
 * provider reachability, pack signatures, worktree orphans. Each check is
 * independent and reported individually — one check's failure never hides
 * another's result (never a silent degrade).
 */

import { promises as fs } from 'node:fs';
import { openEventLogReader, type EventLog } from '@dokima/events';
import { type CredentialStore, resolveCredentialStore } from '@dokima/shared';
import { listTickets } from '@dokima/tickets';
import { auditTailCheck } from '../../bootstrap/audit-tail.js';
import { type CliIO, resolvePort } from '../../bootstrap/cli.js';
import { resolveProjectPaths, type ProjectPaths } from '../../bootstrap/config.js';
import { detectRunningCore } from '../../bootstrap/launch.js';
import {
  defaultFirstPartyPackSource,
  verifyPack,
  type PackManifest,
} from '../../bootstrap/packs-update.js';
import { buildProvider, loadConfiguredProviders } from './providers-core.js';

export type DoctorCheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: DoctorCheckStatus;
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** `false` only when a check is `fail` — a `warn` (e.g. an unreachable local provider) never fails the whole diagnostic. */
  ok: boolean;
}

export interface DoctorDeps {
  detectRunningCore?: typeof detectRunningCore;
  resolveCredentialStore?: (env: NodeJS.ProcessEnv) => CredentialStore;
  loadConfiguredProviders?: typeof loadConfiguredProviders;
  buildProvider?: typeof buildProvider;
  verifyPack?: typeof verifyPack;
  packSource?: { manifestPath: string; contentDir: string; publicKeyPath: string };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function checkPort(io: CliIO, deps: DoctorDeps): Promise<DoctorCheck> {
  const detectRunningCoreImpl = deps.detectRunningCore ?? detectRunningCore;
  const port = resolvePort(io.env);
  const occupied = await detectRunningCoreImpl({ port });
  return {
    name: 'port',
    status: 'ok',
    detail: occupied
      ? `port ${port} is in use by a running dokima core`
      : `port ${port} is free`,
  };
}

async function checkDbIntegrity(paths: ProjectPaths): Promise<DoctorCheck> {
  if (!(await fileExists(paths.dbPath))) {
    return {
      name: 'db-integrity',
      status: 'ok',
      detail: 'no state.db yet (fresh project)',
    };
  }
  const db = openEventLogReader(paths.dbPath);
  try {
    const integrity = db.pragma('integrity_check', { simple: true }) as string;
    if (integrity !== 'ok') {
      return {
        name: 'db-integrity',
        status: 'fail',
        detail: `PRAGMA integrity_check reported: ${integrity}`,
      };
    }
    const log: EventLog = { db, path: paths.dbPath, close: () => {} };
    const tail = auditTailCheck(log);
    if (!tail.valid) {
      return {
        name: 'db-integrity',
        status: 'fail',
        detail: `audit tail broken at seq ${tail.brokenAtSeq ?? 'unknown'}: ${tail.reason ?? 'unknown reason'}`,
      };
    }
    return {
      name: 'db-integrity',
      status: 'ok',
      detail: 'integrity_check ok, chain tail verified',
    };
  } catch (err) {
    return { name: 'db-integrity', status: 'fail', detail: (err as Error).message };
  } finally {
    db.close();
  }
}

const KEYCHAIN_PROBE_REF = 'dokima-doctor-probe';

async function checkKeychain(io: CliIO, deps: DoctorDeps): Promise<DoctorCheck> {
  const resolveCredentialStoreImpl =
    deps.resolveCredentialStore ?? resolveCredentialStore;
  try {
    const store = resolveCredentialStoreImpl(io.env);
    await store.set(KEYCHAIN_PROBE_REF, 'ok');
    const value = await store.get(KEYCHAIN_PROBE_REF);
    await store.delete(KEYCHAIN_PROBE_REF);
    if (value !== 'ok') {
      return {
        name: 'keychain',
        status: 'fail',
        detail: 'round-trip probe returned an unexpected value',
      };
    }
    return {
      name: 'keychain',
      status: 'ok',
      detail: 'keychain read/write probe succeeded',
    };
  } catch (err) {
    return { name: 'keychain', status: 'fail', detail: (err as Error).message };
  }
}

async function checkProviders(io: CliIO, deps: DoctorDeps): Promise<DoctorCheck> {
  const loadConfiguredProvidersImpl =
    deps.loadConfiguredProviders ?? loadConfiguredProviders;
  const buildProviderImpl = deps.buildProvider ?? buildProvider;
  const entries = await loadConfiguredProvidersImpl(io);
  if (entries.length === 0) {
    return { name: 'providers', status: 'ok', detail: 'no providers configured' };
  }
  const results = await Promise.all(
    entries.map(async (entry) => {
      try {
        const health = await buildProviderImpl(entry).health();
        return { entry, ok: health.status === 'ok' };
      } catch {
        return { entry, ok: false };
      }
    }),
  );
  const unreachable = results.filter((r) => !r.ok).map((r) => r.entry.id);
  if (unreachable.length > 0) {
    return {
      name: 'providers',
      status: 'warn',
      detail: `unreachable: ${unreachable.join(', ')} (run 'dokima providers refresh' after fixing)`,
    };
  }
  return {
    name: 'providers',
    status: 'ok',
    detail: `${results.length} provider(s) reachable`,
  };
}

async function checkPackSignatures(deps: DoctorDeps): Promise<DoctorCheck> {
  const verifyPackImpl = deps.verifyPack ?? verifyPack;
  const source = deps.packSource ?? defaultFirstPartyPackSource();
  let result: {
    manifestValid: boolean;
    licenseAllowlisted: boolean;
    rejectedFiles: unknown[];
    manifest: PackManifest;
  };
  try {
    result = await verifyPackImpl(
      source.manifestPath,
      source.contentDir,
      source.publicKeyPath,
    );
  } catch (err) {
    return { name: 'pack-signatures', status: 'fail', detail: (err as Error).message };
  }
  if (!result.manifestValid) {
    return {
      name: 'pack-signatures',
      status: 'fail',
      detail: 'manifest signature does not verify',
    };
  }
  if (!result.licenseAllowlisted) {
    return {
      name: 'pack-signatures',
      status: 'fail',
      detail: `license '${result.manifest.license}' is not allowlisted`,
    };
  }
  if (result.rejectedFiles.length > 0) {
    return {
      name: 'pack-signatures',
      status: 'fail',
      detail: `${result.rejectedFiles.length} file(s) failed hash verification`,
    };
  }
  return {
    name: 'pack-signatures',
    status: 'ok',
    detail: 'manifest + all file hashes verified',
  };
}

async function checkWorktreeOrphans(paths: ProjectPaths): Promise<DoctorCheck> {
  let entries: string[];
  try {
    entries = await fs.readdir(paths.worktreesDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        name: 'worktree-orphans',
        status: 'ok',
        detail: 'no worktrees directory yet',
      };
    }
    return { name: 'worktree-orphans', status: 'fail', detail: (err as Error).message };
  }
  if (entries.length === 0) {
    return { name: 'worktree-orphans', status: 'ok', detail: 'no worktrees present' };
  }

  let inProgressIds = new Set<string>();
  if (await fileExists(paths.dbPath)) {
    const db = openEventLogReader(paths.dbPath);
    try {
      const log: EventLog = { db, path: paths.dbPath, close: () => {} };
      inProgressIds = new Set(
        listTickets(log)
          .filter((t) => t.status === 'in_progress')
          .map((t) => t.id),
      );
    } finally {
      db.close();
    }
  }

  const orphans = entries.filter((name) => !inProgressIds.has(name));
  if (orphans.length > 0) {
    return {
      name: 'worktree-orphans',
      status: 'warn',
      detail: `orphaned worktree dir(s) with no in_progress ticket: ${orphans.join(', ')}`,
    };
  }
  return {
    name: 'worktree-orphans',
    status: 'ok',
    detail: 'every worktree matches an in_progress ticket',
  };
}

export async function runDoctor(io: CliIO, deps: DoctorDeps = {}): Promise<DoctorReport> {
  const paths = resolveProjectPaths(io.cwd);
  const checks = await Promise.all([
    checkPort(io, deps),
    checkDbIntegrity(paths),
    checkKeychain(io, deps),
    checkProviders(io, deps),
    checkPackSignatures(deps),
    checkWorktreeOrphans(paths),
  ]);
  return { checks, ok: checks.every((c) => c.status !== 'fail') };
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines = report.checks.map(
    (c) => `[${c.status.toUpperCase()}] ${c.name}: ${c.detail}`,
  );
  lines.push(report.ok ? 'doctor: OK' : 'doctor: FAILED');
  return lines.join('\n');
}

export async function runDoctorCommand(
  io: CliIO,
  deps: DoctorDeps = {},
): Promise<number> {
  const report = await runDoctor(io, deps);
  io.stdout(renderDoctorReport(report));
  return report.ok ? 0 : 1;
}
