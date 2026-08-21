/**
 * pipeline-routes/model-preflight.ts — the run button's model check
 * (W17-05). Before the run route mints ANY run state, the configured
 * model gets one bounded question. Unreachable = a named 422 carrying the
 * model, the provider, and "Settings -> Models" — never a mid-run surprise
 * minutes later (the 2026-08-21 live UAT hit exactly that window).
 *
 * The explicit `gatewayConfig` seam (tests/CI, law 9a — the e2e fake
 * gateway) SKIPS preflight by design: an injected config is deliberate,
 * and the fake gateway owes no /models contract.
 */
import {
  providerForConfig,
  resolveGatewayConfigForProject,
} from '../gateway-model-port.js';
import { preflightModelReachability } from '../model-resolution.js';

export type PipelinePreflight =
  | { readonly ok: true; readonly warning?: string }
  | {
      readonly ok: false;
      readonly reason: string;
      /** Present when resolution itself failed — the route maps it through the SAME problem shape (409 MODEL_RESOLUTION) it always had. */
      readonly resolutionError?: unknown;
    };

export async function preflightPipelineModel(input: {
  readonly projectPath: string;
  /** Present = the injected test/CI seam; preflight is skipped. */
  readonly injectedConfig?: unknown;
}): Promise<PipelinePreflight> {
  if (input.injectedConfig !== undefined) return { ok: true };
  let config;
  try {
    config = await resolveGatewayConfigForProject(input.projectPath);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      resolutionError: err,
    };
  }
  const provider = await providerForConfig(config);
  const preflight = await preflightModelReachability(provider, config.model);
  if (!preflight.ok) {
    return {
      ok: false,
      reason:
        `the configured model "${config.model}" cannot be reached — ` +
        `${preflight.reason}. Fix it under Settings -> Models; the run was not started.`,
    };
  }
  if (preflight.listed === false) {
    return {
      ok: true,
      warning:
        `the endpoint is reachable but does not list "${config.model}" — if it ` +
        `loads models on demand this will still work.`,
    };
  }
  return { ok: true };
}
