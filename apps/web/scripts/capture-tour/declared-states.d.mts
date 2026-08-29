/**
 * Types for `declared-states.mjs` so the tour's coverage list can be imported
 * from TypeScript — specifically by `e2e/tour-contract.spec.ts`, which asserts
 * these surfaces still exist inside the gate Law 3 already runs.
 *
 * Kept beside the source rather than inlined at the import: a caller asserting
 * a shape it declared itself proves nothing about the list it is checking.
 */
export interface DeclaredSettingsTab {
  readonly label: string;
  readonly testId: string;
  readonly slug: string;
}

export interface DeclaredState {
  readonly id: string;
  readonly why?: string;
}

export declare const SETTINGS_TABS: readonly DeclaredSettingsTab[];
export declare const DECLARED_STATES: readonly (string | DeclaredState)[];
