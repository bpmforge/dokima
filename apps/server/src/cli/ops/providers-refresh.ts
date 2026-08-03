/**
 * `dokima providers refresh` (DEPLOYMENT.md §7/§8): "re-runs
 * discovery/warm-up" for every configured provider — the fix for stale
 * endpoint discovery (Ollama and LM Studio expose different discovery
 * routes; a proxy in between often strips them).
 *
 * Discovery already existed here (`provider.listModels()`) but the result
 * was thrown away after computing `modelCount` (W10-02). It now resolves
 * through `@dokima/gateway`'s catalog module, which persists and exposes
 * the list, and falls back to the bundled offline catalog when the
 * provider is unreachable (Law 9 / C-1 — first run must work with zero
 * network; the fallback is always reported as `bundled`, distinct from a
 * live `discovered` result, and the provider still shows unreachable with
 * its reason — never a fabricated list, W9-15's honest-absence rule).
 */

import {
  resolveProviderCatalog,
  type CatalogModel,
  type CatalogSource,
  type Provider,
} from '@dokima/gateway';
import type { CliIO } from '../../bootstrap/cli.js';
import {
  buildProvider,
  loadConfiguredProviders,
  type ProviderConfigEntry,
} from './providers-core.js';

export interface ProvidersRefreshDeps {
  loadConfiguredProviders?: typeof loadConfiguredProviders;
  buildProvider?: typeof buildProvider;
}

interface RefreshOutcome {
  entry: ProviderConfigEntry;
  models: readonly CatalogModel[];
  source: CatalogSource | null;
  warmUpOk: boolean;
  error: string | null;
}

async function refreshOne(
  entry: ProviderConfigEntry,
  provider: Provider,
): Promise<RefreshOutcome> {
  const catalog = await resolveProviderCatalog(entry.id, entry.kind, provider);
  if (catalog.status === 'unreachable') {
    return {
      entry,
      models: catalog.models,
      source: catalog.source,
      warmUpOk: false,
      error: catalog.reason ?? 'unreachable',
    };
  }
  try {
    const warmUp = await provider.warmUp();
    return {
      entry,
      models: catalog.models,
      source: catalog.source,
      warmUpOk: warmUp.status === 'ok',
      error: null,
    };
  } catch (err) {
    return {
      entry,
      models: catalog.models,
      source: catalog.source,
      warmUpOk: false,
      error: (err as Error).message,
    };
  }
}

export async function runProvidersRefreshCommand(
  io: CliIO,
  deps: ProvidersRefreshDeps = {},
): Promise<number> {
  const loadConfiguredProvidersImpl =
    deps.loadConfiguredProviders ?? loadConfiguredProviders;
  const buildProviderImpl = deps.buildProvider ?? buildProvider;

  const entries = await loadConfiguredProvidersImpl(io);
  if (entries.length === 0) {
    io.stdout('providers refresh: no providers configured — nothing to refresh');
    return 0;
  }

  const outcomes = await Promise.all(
    entries.map((entry) => refreshOne(entry, buildProviderImpl(entry))),
  );

  let anyFailed = false;
  for (const outcome of outcomes) {
    const label = `${outcome.entry.id} (${outcome.entry.kind})`;
    const names = outcome.models.map((m) => m.id);
    if (outcome.error) {
      anyFailed = true;
      const fallback =
        outcome.source === 'bundled'
          ? ` — offline: bundled catalog offers ${names.length} known model(s) [${names.join(', ')}]`
          : '';
      io.stdout(`providers refresh: ${label} — unreachable: ${outcome.error}${fallback}`);
    } else if (names.length === 0) {
      io.stdout(
        `providers refresh: ${label} — reachable, but this endpoint serves no models yet, warm-up ${outcome.warmUpOk ? 'ok' : 'failed'}`,
      );
    } else {
      io.stdout(
        `providers refresh: ${label} — ${names.length} model(s) discovered [${names.join(', ')}], warm-up ${outcome.warmUpOk ? 'ok' : 'failed'}`,
      );
    }
  }
  return anyFailed ? 1 : 0;
}
