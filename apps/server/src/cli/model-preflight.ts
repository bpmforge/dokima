/**
 * model-preflight.ts — refuse a model the provider does not serve, before any
 * ticket is claimed (W21-78).
 *
 * THE FOUNDER'S ASK WAS "make sure qwen3.6-35b-a3b is never used". No
 * production code ever selected it: presets build from the user's own picks,
 * and the only live source was the every-project default in
 * ~/.dokima/config.json, written 2026-08-03 and never revisited. A project
 * created through the UI silently inherited it.
 *
 * Deleting a string does not stop that recurring. The hole underneath is that
 * nothing checks a configured model against what the provider actually serves.
 * `ProviderUnreachableError` exists, but it is raised at REQUEST time — after
 * the ticket is claimed, the worktree provisioned, and the session started —
 * so an unreachable model presents as a session that burned its budget and
 * parked as something else entirely (W21-63, W21-64).
 *
 * TWO SHAPES OF THE SAME HOLE, both seen live. Tally's provider row read "Not
 * tested yet" with no models discovered, and the run started anyway on a model
 * the UI could not offer in its own dropdown. And the catalogue lists what is
 * KNOWN, not what is LOCAL — qwen3.6-35b-a3b appears in LM Studio's
 * /v1/models while being served by a linked machine, so even a listed model
 * can be the wrong answer.
 *
 * NOT A BLOCKLIST. Naming forbidden models would be unmaintainable and would
 * not have caught this one, which was listed. Ask the provider what it serves.
 *
 * A PROVIDER THAT CANNOT ENUMERATE IS NOT A PROVIDER THAT REFUSES. An empty
 * list means "I do not answer that question", and turning silence into a
 * refusal would break every provider without a models endpoint. Silence
 * degrades to today's behaviour; only a provider that answers, and answers
 * without this model, refuses (FR-G5: degrade honestly, never silently).
 */
import { ModelResolutionError } from '../api/pipeline/model-resolution.js';

/** Just the part of a Provider this needs, so tests need no gateway. */
export interface ModelLister {
  readonly id: string;
  listModels(): Promise<readonly { readonly id: string }[]>;
}

/** How many of the provider's own models to name, so the message is actionable. */
const SUGGEST = 5;

export function modelNotServed(
  model: string,
  providerId: string,
  served: readonly string[],
): ModelResolutionError {
  const near = served.filter((id) => {
    const [a, b] = [id.toLowerCase(), model.toLowerCase()];
    return a.includes(b) || b.includes(a) || a.split('/').pop() === b.split('/').pop();
  });
  const suggest = (near.length > 0 ? near : served).slice(0, SUGGEST);
  return new ModelResolutionError(
    `${providerId} does not serve "${model}". It serves ${served.length} model(s), ` +
      `including: ${suggest.join(', ')}. Nothing was claimed and no session ran — ` +
      `choose a model this provider actually has in Settings → Models, or point ` +
      `the provider at the machine that serves this one.`,
    'model-not-served',
  );
}

/**
 * Refuses when the provider answers and this model is not in the answer.
 * A provider that cannot be reached, or that enumerates nothing, is left to
 * the request path exactly as before — this adds a refusal, never a new
 * failure mode.
 */
export async function assertModelIsServed(
  provider: ModelLister,
  model: string,
): Promise<void> {
  if (!model) return;
  let served: readonly { readonly id: string }[];
  try {
    served = await provider.listModels();
  } catch {
    // Unreachable, or no models endpoint. The request path already reports
    // this precisely (ProviderUnreachableError); guessing here would only
    // turn one clear failure into two.
    return;
  }
  if (served.length === 0) return;
  const ids = served.map((m) => m.id);
  if (ids.includes(model)) return;
  throw modelNotServed(model, provider.id, ids);
}
