/**
 * `shipwright providers refresh` (DEPLOYMENT.md §7/§8): "re-runs
 * discovery/warm-up" for every configured provider — the fix for stale
 * endpoint discovery (Ollama and LM Studio expose different discovery
 * routes; a proxy in between often strips them).
 */

import type { Provider } from '@shipwright/gateway';
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
  modelCount: number | null;
  warmUpOk: boolean;
  error: string | null;
}

async function refreshOne(
  entry: ProviderConfigEntry,
  provider: Provider,
): Promise<RefreshOutcome> {
  try {
    const models = await provider.listModels();
    const warmUp = await provider.warmUp();
    return {
      entry,
      modelCount: models.length,
      warmUpOk: warmUp.status === 'ok',
      error: null,
    };
  } catch (err) {
    return {
      entry,
      modelCount: null,
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
    if (outcome.error) {
      anyFailed = true;
      io.stdout(
        `providers refresh: ${outcome.entry.id} (${outcome.entry.kind}) — unreachable: ${outcome.error}`,
      );
    } else {
      io.stdout(
        `providers refresh: ${outcome.entry.id} (${outcome.entry.kind}) — ${outcome.modelCount} model(s) discovered, warm-up ${outcome.warmUpOk ? 'ok' : 'failed'}`,
      );
    }
  }
  return anyFailed ? 1 : 0;
}
