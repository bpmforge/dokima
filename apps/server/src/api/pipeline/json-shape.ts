/**
 * Minimal structural validators for parsing a model's JSON completion into
 * `@shipwright/pipeline`'s typed port inputs (`gateway-model-port.ts`). Deep
 * semantic validation (option counts, dimension completeness, duplicate
 * keys, ...) stays in the pure phase modules themselves
 * (`synthesizeBlueprint`/`buildTechnicalSlate`, both already throw typed
 * errors) — these helpers only guarantee the JSON has the right shape to
 * reach those functions at all.
 */
import { MalformedModelOutputError } from './errors.js';

export function requireObject(
  value: unknown,
  phase: string,
  path: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MalformedModelOutputError(phase, `"${path}" must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireArray(value: unknown, phase: string, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new MalformedModelOutputError(phase, `"${path}" must be an array`);
  }
  return value;
}

/** Same as `requireArray`, but `undefined`/`null` defaults to `[]` (optional fields). */
export function requireOptionalArray(
  value: unknown,
  phase: string,
  path: string,
): unknown[] {
  if (value === undefined || value === null) return [];
  return requireArray(value, phase, path);
}

export function requireString(value: unknown, phase: string, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new MalformedModelOutputError(phase, `"${path}" must be a non-empty string`);
  }
  return value;
}
