/**
 * providers-model-refs.ts — what the Models panel may offer (W21-24).
 *
 * A chapter of `providers-api.ts`, split when adding the qualification rule
 * pushed that file past the 400-line CODE_BOOK_PROTOCOL cap. One concern: the
 * string that names a model to the resolver, and how to read one back.
 */
import type { CatalogModel, ProviderCatalog, ProviderEntry } from './providers-api.js';

/**
 * W21-24: the ref the RESOLVER will accept for this model, which is not always
 * the model's own id.
 *
 * `model-resolution.ts` resolves a bare ref only when exactly one provider is
 * enabled. With two or more it refuses — "has no provider prefix and 2
 * providers are enabled — qualify it as <providerId>/<model>" — and that
 * refusal is a good one: it names the problem, names the fix, and costs
 * nothing. The defect was that the fix it names could not be performed here.
 * Every option this function produced was a bare id, and the control is a
 * `<select>`, so enabling a second provider made this panel unable to express
 * ANY valid configuration and the only escape was disabling a provider again.
 *
 * The resolver's own docstring records this class from the other side: "the
 * W10-04 panel offered the model and the resolver then refused it". Same
 * mismatch, opposite direction, and the rule below is written to mirror
 * `splitModelRef`/`resolveBoundModel` exactly rather than to approximate them.
 *
 * MIRRORED BY HAND ON PURPOSE. `apps/web` takes no dependency on
 * `@dokima/shared` (its types are hand-mirrored too, see board/types.ts), so
 * the guarantee that what is offered is what is accepted cannot be a shared
 * import. It is a test on each side over the same strings instead —
 * providers-api.test.ts here and model-resolution.test.ts there.
 */
export function modelRefFor(
  providerId: string,
  modelId: string,
  enabledProviderCount: number,
): string {
  return enabledProviderCount > 1 ? `${providerId}/${modelId}` : modelId;
}

/**
 * Splits a matrix ref into provider and model. Mirrors `splitModelRef`: a
 * prefix is a providerId ONLY when it names a registered provider, because
 * model ids legitimately contain slashes (`qwen/qwen3-coder-next`,
 * `mlx-community/…`) and guessing turns a model into a provider that does not
 * exist.
 */
export function splitModelRefLocal(
  value: string,
  knownProviderIds: readonly string[],
): { providerId?: string; model: string } {
  const slash = value.indexOf('/');
  if (slash <= 0) return { model: value };
  const prefix = value.slice(0, slash);
  if (!knownProviderIds.includes(prefix)) return { model: value };
  return { providerId: prefix, model: value.slice(slash + 1) };
}

/**
 * Can this model do the work a picker is asking about? (W21-94)
 *
 * Only a model the provider REPORTED as an embedding model is refused. An
 * embedding model cannot generate text at all, so offering one as "the model
 * that writes the code" hands the user a setup broken by construction, with a
 * failure that surfaces much later — measured 2026-08-28, LM Studio served
 * four among 34 and the picker listed all 34.
 *
 * ABSENCE NEVER REMOVES A CHOICE. A provider that reports no kind (ollama, any
 * generic OpenAI-compatible endpoint) yields `undefined`, and every one of its
 * models stays on offer. Filtering on a guess would take working models away
 * from people whose endpoint simply does not describe itself.
 */
export function canGenerate(model: CatalogModel): boolean {
  return model.kind !== 'embedding';
}

export function combinedModelOptions(
  catalogs: Record<string, ProviderCatalog>,
  entries: readonly ProviderEntry[],
): string[] {
  const enabledIds = new Set(entries.filter((e) => e.enabled).map((e) => e.id));
  const ids = new Set<string>();
  for (const [providerId, catalog] of Object.entries(catalogs)) {
    if (!enabledIds.has(providerId)) continue;
    for (const model of catalog.models) {
      if (!canGenerate(model)) continue;
      ids.add(modelRefFor(providerId, model.id, enabledIds.size));
    }
  }
  return [...ids].sort();
}

/**
 * The provider currently serving `model`, across every known catalog
 * (enabled or not) — used to render "missing from <provider>" vs.
 * "unroutable — provider disabled" for an existing matrix row. Prefers an
 * enabled provider when more than one catalog lists the same model id, so a
 * model available from both a disabled and an enabled endpoint is never
 * misreported as unroutable.
 */
export function findServingProviderId(
  model: string,
  catalogs: Record<string, ProviderCatalog>,
  entries: readonly ProviderEntry[],
): string | undefined {
  const entryById = new Map(entries.map((e) => [e.id, e]));
  // W21-24: a row may now be provider-qualified. The prefix, when it names a
  // registered provider, IS the answer — and the bare remainder is what the
  // catalogue lists.
  const split = splitModelRefLocal(model, [...entryById.keys()]);
  if (split.providerId !== undefined) return split.providerId;
  let disabledMatch: string | undefined;
  for (const [providerId, catalog] of Object.entries(catalogs)) {
    if (!catalog.models.some((m) => m.id === model)) continue;
    if (entryById.get(providerId)?.enabled) return providerId;
    disabledMatch ??= providerId;
  }
  return disabledMatch;
}

