/**
 * gateway-model-port/pricing.ts — real per-model prices, and a refusal when
 * there isn't one (W12-11, D-024).
 *
 * WHY THIS EXISTS: `normalizeUsage` computes `costUsd` from a `CostTable`, and
 * a model missing from that table costs **$0** — silently. For a local model
 * that is true. For a paid API it is a fabrication, and not merely a reporting
 * one: W2-07's budget breakers read the spend ledger, so a breaker that always
 * sees $0 can never trip. Metering a cloud call at $0 disables the spend
 * controls entirely while looking like they work. That is why cloud provider
 * kinds were refused outright until this ticket, and why the refusal moves
 * here rather than disappearing.
 *
 * NO PROVIDER RETURNS COST. Verified against our own adapters, not assumed:
 * Anthropic yields `input_tokens`/`output_tokens` (anthropic.ts:209), OpenAI
 * `prompt_tokens`/`completion_tokens` (openai.ts:258). `costUsd` is ours,
 * computed at usage.ts:28. Vendors do expose account-level cost APIs, but
 * those are aggregated and delayed — an audit check, never a source a
 * pre-call breaker can use.
 *
 * OFFLINE BY CONSTRUCTION (C-1/D-024): prices are read from a file that ships
 * with the product. Nothing here fetches, at startup or ever, so choosing
 * local-only still boots with no network and CLAUDE.md law 9(a) is untouched.
 */
import { readFileSync } from 'node:fs';
import { resolveAsset } from '@dokima/shared';
import type { CostTable, ModelPrice } from '@dokima/gateway';

/**
 * Past this, the map is reported as stale — it still meters, because a
 * slightly-old price beats no price at all, and refusing to run because a
 * JSON file aged would be a worse failure than a small costing error.
 */
export const STALE_AFTER_DAYS = 90;

export class PricingUnavailableError extends Error {
  constructor(
    message: string,
    readonly code: 'model-unpriced' | 'pricing-unreadable',
  ) {
    super(message);
    this.name = 'PricingUnavailableError';
  }
}

interface PricingFile {
  readonly version: number;
  readonly asOf: string;
  readonly providers: Record<string, Record<string, ModelPrice>>;
}

/** Kinds that are honestly free per token — see pricing.v1.json `notes`. */
export const UNPRICED_BY_DESIGN = new Set(['ollama', 'lm-studio', 'copilot']);

let cached: PricingFile | null = null;

export function loadPricingFile(pathOverride?: string): PricingFile {
  if (!pathOverride && cached) return cached;
  const file =
    pathOverride ?? resolveAsset('content', 'model-catalog', 'pricing.v1.json');
  let parsed: PricingFile;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as PricingFile;
  } catch (err) {
    throw new PricingUnavailableError(
      `the model price map at ${file} could not be read (${err instanceof Error ? err.message : String(err)}). ` +
        `Cloud calls cannot be metered without it, and metering them at $0 would silently disable the budget breakers.`,
      'pricing-unreadable',
    );
  }
  if (!pathOverride) cached = parsed;
  return parsed;
}

/** Exposed for tests; the module-level cache would otherwise leak between cases. */
export function resetPricingCache(): void {
  cached = null;
}

export interface PricingLookup {
  readonly costTable: CostTable;
  readonly asOf: string;
  readonly staleDays: number;
  readonly stale: boolean;
}

/**
 * The `CostTable` for one provider kind, or a NAMED REFUSAL when the model
 * has no price. Refusing is the whole point: the alternative is a $0 that
 * looks like a working meter.
 */
export function costTableFor(
  kind: string,
  model: string,
  opts: { readonly now?: Date; readonly pathOverride?: string } = {},
): PricingLookup {
  const pricing = loadPricingFile(opts.pathOverride);
  const forKind = pricing.providers[kind] ?? {};
  const price = forKind[model];
  if (!price) {
    const known = Object.keys(forKind);
    throw new PricingUnavailableError(
      `no price is on record for model "${model}" on provider kind "${kind}" ` +
        `(price map asOf ${pricing.asOf}). Refusing rather than metering it at $0, which ` +
        `would leave the budget breakers unable to fire on a paid API. ` +
        (known.length > 0
          ? `Priced models for this kind: ${known.join(', ')}. `
          : `No models are priced for this kind. `) +
        `Add it to content/model-catalog/pricing.v1.json, or set the rate on the provider entry.`,
      'model-unpriced',
    );
  }
  const now = opts.now ?? new Date();
  const asOfMs = Date.parse(pricing.asOf);
  const staleDays = Number.isNaN(asOfMs)
    ? Number.POSITIVE_INFINITY
    : Math.floor((now.getTime() - asOfMs) / 86_400_000);
  return {
    costTable: { [model]: price },
    asOf: pricing.asOf,
    staleDays,
    stale: staleDays > STALE_AFTER_DAYS,
  };
}

/** The warning text for a stale map — a warning, never a refusal (see STALE_AFTER_DAYS). */
export function stalePricingWarning(lookup: PricingLookup): string {
  return (
    `model prices are ${lookup.staleDays} days old (asOf ${lookup.asOf}, stale after ` +
    `${STALE_AFTER_DAYS}). Spend figures may be wrong; refresh ` +
    `content/model-catalog/pricing.v1.json or override the rate on the provider entry.`
  );
}
