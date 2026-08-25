/**
 * Per-member escalation policy (W20-06, D-029) — chapter of
 * `run-build-policy.ts`, split when it crossed the 400-line CODE_BOOK cap.
 * Extraction plus the W20-06 addition; the parent keeps the single-role
 * resolver these build on.
 */
import type { JsonValue } from '@dokima/shared';
import type { LandEscalationPolicy, ScopedLandEscalationPolicy } from '@dokima/harbormaster';
import { resolvePolicyScope } from './run-build-policy.js';

/**
 * W20-06 (D-029/D-030): every member may carry their own policy.
 *
 * The stored value may be either the legacy flat object (one policy, applied
 * to `role` as W12-18 did) or `{ roles: { <role>: { mode, … } } }`. Per-role
 * resolution is what OPERATIONS.md's "each member has their own settings"
 * requires; the flat form is still honoured so an existing install keeps
 * meaning exactly what it meant.
 */
export function resolvePerRolePolicyScope(
  raw: JsonValue | undefined,
  roles: readonly string[],
): { readonly scope: ScopedLandEscalationPolicy } | { readonly refusal: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { scope: {} };
  const value = raw as Record<string, unknown>;
  const perRole = value.roles;
  if (!perRole || typeof perRole !== 'object' || Array.isArray(perRole)) {
    // Legacy flat shape: one policy for the maker, exactly as before.
    return resolvePolicyScope(raw, roles[0] ?? 'coding-agent');
  }
  const merged: Record<string, LandEscalationPolicy> = {};
  for (const [roleId, policy] of Object.entries(perRole as Record<string, unknown>)) {
    const one = resolvePolicyScope(policy as JsonValue, roleId);
    if ('refusal' in one) return one;
    const entry = one.scope.global?.[roleId];
    if (entry) merged[roleId] = entry;
  }
  return { scope: Object.keys(merged).length > 0 ? { global: merged } : {} };
}

/**
 * W20-06 (D-029): does this member's policy want the founder's approval before
 * climbing? `ask` DEFERS — the current attempt keeps running on the rung it is
 * on, and the climb waits for an answer that arrives through the founder queue.
 * An unattended overnight run therefore never hangs mid-ladder.
 */
export function isAskMode(raw: JsonValue | undefined, role: string): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  const perRole = value.roles as Record<string, unknown> | undefined;
  const forRole =
    perRole && typeof perRole === 'object' && !Array.isArray(perRole)
      ? (perRole[role] as Record<string, unknown> | undefined)
      : value;
  return forRole?.mode === 'ask';
}

