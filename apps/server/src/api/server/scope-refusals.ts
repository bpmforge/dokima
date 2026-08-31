/**
 * scope-refusals.ts — what a settings write may not do (W22-24 chapter split).
 *
 * Four guards, one shape: each inspects the body of a settings PUT, and either
 * returns false (nothing to say) or sends a 400 problem naming the field and a
 * rule id. Both settings routes — global and per-project — run all four, so a
 * rule can never hold on one door and not the other.
 *
 * THEY MOVED TOGETHER because they are one concern, not because of a line
 * count — though the count is what forced the question: adding the provider
 * guard took scope-routes.ts to 417 lines, over the 400-line
 * CODE_BOOK_PROTOCOL cap, the same wall W22-17 hit on the ladder engine.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PRESET_NAMES, validateProviderRegistry } from '@dokima/gateway';
import type { JsonValue, SettingsMap } from '@dokima/shared';
import { badRequest, forbidden } from './settings-route-helpers.js';
import { AGENT_RUNNER_SETTINGS_KEY } from './settings-types.js';
import { PROVIDERS_SETTINGS_KEY } from './providers-store.js';

export function isPlainSettingsBody(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * D-019 consent gate + any NEVER-AUTO-adjacent flag: these keys only ever
 * flip through their dedicated consent/confirmation endpoint (Copilot's
 * `POST/DELETE /projects/{id}/copilot-consent`, which mints the ledgered
 * `copilot.consent_ack` event per FR-G6). The generic key/value settings
 * PUT below is a flat pass-through with no per-key validation otherwise, so
 * without this blocklist a caller could `PUT {"copilotEnabled": true}`
 * straight through it and silently bypass the consent gate — no risk
 * warning shown, no ack event minted. Reject the whole request (never
 * silently drop just the gated key) so the caller sees the bypass attempt
 * fail loudly.
 */
const CONSENT_GATED_KEYS = new Set(['copilotEnabled']);

export function findConsentGatedKey(body: Record<string, JsonValue>): string | undefined {
  return Object.keys(body).find((key) => CONSENT_GATED_KEYS.has(key));
}

/** Sends the 403 refusal and returns true if `body` names a consent-gated key — call before any write, on both the global and project generic PUTs. */
export function refuseConsentGatedKey(
  request: FastifyRequest,
  reply: FastifyReply,
  body: unknown,
): boolean {
  if (!isPlainSettingsBody(body)) return false;
  const gatedKey = findConsentGatedKey(body);
  if (!gatedKey) return false;
  reply
    .code(403)
    .type('application/problem+json')
    .send(
      forbidden(
        request,
        `"${gatedKey}" is consent-gated (D-019) and cannot be set via the generic settings PUT — use its dedicated consent endpoint instead`,
        'consent-gated-key',
      ),
    );
  return true;
}

/**
 * `defaultModelMatrixPreset`'s only legal values are `@dokima/gateway`'s
 * shipped preset names (FR-S3, W10-42 AC5). `PUT /api/v1/settings/global`
 * (FirstRunWizard's `savePresetAndProvider`) is the only caller that writes
 * this key today, but the generic settings PUT otherwise passes any value
 * straight through with no per-key validation at *either* scope — and
 * `getEffectiveProjectSettings` resolves run > project > global, so an
 * unvalidated project-scope write would win over a validated global one.
 * Checked on both PUTs for the same reason `refuseConsentGatedKey` is
 * (defense in depth, not just the one call site in active use).
 */
export function findInvalidPreset(body: Record<string, JsonValue>): JsonValue | undefined {
  if (!('defaultModelMatrixPreset' in body)) return undefined;
  const value = body.defaultModelMatrixPreset;
  return typeof value === 'string' && (PRESET_NAMES as readonly string[]).includes(value)
    ? undefined
    : value;
}

/** Sends the 400 refusal and returns true if `body` names an unrecognized `defaultModelMatrixPreset` — malformed input, not a consent denial, hence 400 not 403. */
export function refuseUnknownPreset(
  request: FastifyRequest,
  reply: FastifyReply,
  body: unknown,
): boolean {
  if (!isPlainSettingsBody(body)) return false;
  const invalid = findInvalidPreset(body);
  if (invalid === undefined) return false;
  reply
    .code(400)
    .type('application/problem+json')
    .send(
      badRequest(
        request,
        `"defaultModelMatrixPreset" must be one of ${PRESET_NAMES.join(', ')}, got ${JSON.stringify(invalid)}`,
        'unknown-preset',
      ),
    );
  return true;
}

/**
 * A provider registry must be READABLE by the code that will read it (W22-24).
 *
 * `PUT /projects/:id/providers` validates and normalises: it refuses an entry
 * with no `enabled` naming the field and the rule, and it accepts the wire's
 * snake_case `base_url`, storing the canonical `baseUrl`. This route accepted
 * ANY JSON under the same key and stored it verbatim.
 *
 * So the identical payload was correct on one route and silently broken on the
 * other. Written here with `base_url`, the stored entry has no `baseUrl` at
 * all, and nothing complains until a different command much later reports
 * `providers refresh: local (oai-compat) — unreachable: endpoint unreachable —
 * TypeError: Failed to parse URL from /models` — a raw parser error about a
 * relative path, for a mistake made minutes earlier somewhere else.
 *
 * The validator already existed and the project route already called it. This
 * is the same guard on the second door, in the shape the three refusals above
 * it already use.
 */
export function refuseUnreadableProviders(
  request: FastifyRequest,
  reply: FastifyReply,
  body: unknown,
): boolean {
  if (!isPlainSettingsBody(body)) return false;
  const raw = body[PROVIDERS_SETTINGS_KEY];
  if (raw === undefined) return false;
  try {
    validateProviderRegistry(raw);
    return false;
  } catch (err) {
    reply
      .code(400)
      .type('application/problem+json')
      .send(
        badRequest(
          request,
          `"${PROVIDERS_SETTINGS_KEY}" is not a readable provider registry: ${
            err instanceof Error ? err.message : String(err)
          }`,
          'invalid-provider-registry',
        ),
      );
    return true;
  }
}

/**
 * W11-20 (C-2/C-3, FR-S2): `agentRunner.command` is the executable
 * `resolveAgentRunner` (run-build.ts) spawns verbatim on every subsequent
 * build run — a strictly bigger decision than `copilotEnabled` above, which
 * already had a gate (`CONSENT_GATED_KEYS`) while this key had none.
 *
 * Threat model this gate is sized for (the question the note filing this
 * ticket left open): this whole surface is bearer-token-gated and typically
 * reachable only on loopback — the realistic "unattended writer" is a local
 * process, a stale/replayed request, or a script that knows the settings
 * wire shape, not a remote attacker who already has the token. That is why
 * a same-request confirmation flag is proportionate here, rather than a
 * ledgered consent event guarding against a hostile-remote-caller model.
 *
 * Chose "require an explicit confirmation flag in the same PUT" over
 * blocking the key outright (acceptance 3/4): unlike `copilotEnabled`,
 * `external` is a legitimate, supported choice (W11-04) with its own
 * dedicated route to reach settings through — there isn't one for
 * `agentRunner`, and building one (a consent ledger event, its own
 * endpoint) would be the "new mechanism" acceptance 3 says not to reach
 * for. A flat block would also make a deliberate operator choice
 * indistinguishable from an unattended write, which acceptance 4 calls out
 * as the wrong axis (value-unusualness) to gate on.
 *
 * The flag is the "who is asking" signal instead: `AgentRunnerPanel.tsx`
 * always shows `EXTERNAL_AGENT_WARNING` before an external command can be
 * typed in, and sends this flag alongside the value once the operator
 * saves — same request, so there is no window where the value is stored
 * unconfirmed. A caller that only knows the generic settings wire shape
 * (replaying a captured request, or writing straight to the key) will not
 * know to set it. The flag never becomes a stored setting — stripped
 * before the write, see `withoutAgentRunnerConfirmField` below — so it
 * can't leak into `GET`/effective-settings responses or be mistaken for a
 * real key.
 *
 * Only `kind: 'external'` requires it, and only when it actually CHANGES
 * what would be spawned (acceptance 5's wording: "a PUT that changes
 * `agentRunner.command`"): reverting to `built-in` (D-023's safe default)
 * is never gated, and re-PUTting the exact `kind`/`command` that is already
 * stored is not "choosing what the host executes" — it's a no-op. This
 * matters beyond convenience: `AgentRunnerPanel.tsx` itself fetches the
 * full settings map and spreads it back on every save, so any future save
 * path that follows the same read-modify-write shape and happens to carry
 * an already-stored `agentRunner` forward — because some OTHER key in the
 * same map is what's actually changing — must not require re-confirming a
 * choice nobody is making in this request. Gating on bare presence of
 * `kind: 'external'` would 403 that unrelated save; gating on an actual
 * change does not, and still refuses on the one case that matters (a
 * different `kind`/`command` written with no flag).
 */
const AGENT_RUNNER_CONFIRM_FIELD = 'agentRunnerConfirmed';

export function isExternalAgentRunnerValue(
  value: JsonValue | undefined,
): value is Record<string, JsonValue> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, JsonValue>).kind === 'external'
  );
}

/** Whether `next` (already known external) names the same kind/command `current` already has stored — the only two fields `AgentRunnerSetting` carries, so field-equality is value-equality here. */
export function sameAgentRunnerValue(next: JsonValue, current: JsonValue | undefined): boolean {
  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    return false;
  }
  const a = next as Record<string, JsonValue>;
  const b = current as Record<string, JsonValue>;
  return a.kind === b.kind && a.command === b.command;
}

/**
 * Sends the 403 refusal and returns true if `body` CHANGES `agentRunner` to
 * an external command without the confirmation flag — call before any
 * write, on both the global and project generic PUTs. `readCurrent` is a
 * thunk (not the settings map itself) so the extra read it costs only
 * happens on the rare path that already needs one: a body naming an
 * external `agentRunner` with no confirmation flag set.
 */
export async function refuseUnconfirmedAgentRunner(
  request: FastifyRequest,
  reply: FastifyReply,
  body: unknown,
  readCurrent: () => Promise<SettingsMap>,
): Promise<boolean> {
  if (!isPlainSettingsBody(body)) return false;
  const next = body[AGENT_RUNNER_SETTINGS_KEY];
  if (!isExternalAgentRunnerValue(next)) return false;
  if (body[AGENT_RUNNER_CONFIRM_FIELD] === true) return false;
  const current = await readCurrent();
  if (sameAgentRunnerValue(next, current[AGENT_RUNNER_SETTINGS_KEY])) return false;
  reply
    .code(403)
    .type('application/problem+json')
    .send(
      forbidden(
        request,
        `setting "${AGENT_RUNNER_SETTINGS_KEY}" to kind "external" chooses the binary the host spawns on every subsequent build run — this PUT must also carry "${AGENT_RUNNER_CONFIRM_FIELD}": true in the same request`,
        'agent-runner-confirmation-required',
      ),
    );
  return true;
}

/** Drops `AGENT_RUNNER_CONFIRM_FIELD` from `body` before it reaches `applyEachKey` — it is a same-request confirmation signal, never a real settings key, and must not get persisted as one. */
export function withoutAgentRunnerConfirmField(body: unknown): unknown {
  if (!isPlainSettingsBody(body)) return body;
  if (!(AGENT_RUNNER_CONFIRM_FIELD in body)) return body;
  const rest: Record<string, JsonValue> = { ...body };
  delete rest[AGENT_RUNNER_CONFIRM_FIELD];
  return rest;
}
