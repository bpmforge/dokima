/**
 * Seam union (P3-02) — the generalization of `decompose`'s `InterfaceRef`.
 *
 * `InterfaceRef` ({packageName, exportName}) names exactly ONE kind of seam
 * between tickets: a public export. The field-report classes it was built for
 * (W0-08, W1-02) have siblings that same lint can never see — a route one
 * ticket serves and another calls, a DB column one migration adds and another
 * reads, a DI binding, an event topic, a nav entry, a config key, a feature
 * flag. This module widens the model into a tagged union WITHOUT touching
 * `decompose` (Law L4: extend the existing model, never run a parallel one) —
 * `adapter.ts#fromInterfaceRef` lifts every existing `InterfaceRef` into the
 * `export` arm losslessly, so decompose data joins the union with no edits.
 *
 * Field names are snake_case (`wiring_evidence`, `contract_test`,
 * `consumer_ticket`) deliberately: seams are BOARD-plane data, the same plane
 * as plan.json's `write_scope`/`depends_on`, so a board can carry them and the
 * conductor bridge can read them without a casing-mapping layer.
 *
 * THE GAP THE EVIDENCE FIELD CLOSES: `findUnownedInterfaces` is plan-time
 * only — a ticket can DECLARE `providesInterfaces` and never write the
 * export, and lint stays green. `wiring_evidence` is a DETERMINISTIC,
 * build-time-checkable assertion spec (see `assert.ts`): the seam is wired
 * only if the named file exists and carries the named export / matches the
 * named pattern. No model judgment anywhere.
 */

/** The seam kinds the union covers. `export` is the existing InterfaceRef shape. */
export type SeamKind =
  | 'export'
  | 'route'
  | 'db-column'
  | 'di-binding'
  | 'event-topic'
  | 'nav-entry'
  | 'config-key'
  | 'feature-flag';

/**
 * Evidence for an `export` seam: `file` must exist AND contain an export of
 * `exportName` (declaration or re-export, `as`-renames included).
 */
export interface ExportEvidence {
  readonly file: string;
  readonly exportName: string;
}

/** Evidence for a `route` seam: `file` must exist AND `pattern` (a regex
 * source string) must match its content. */
export interface RouteEvidence {
  readonly file: string;
  readonly pattern: string;
}

/** Generic evidence (all non-export, non-route kinds): `file` must exist;
 * when `pattern` is present it must also match the file's content. */
export interface GenericEvidence {
  readonly file: string;
  readonly pattern?: string;
}

/** Fields every seam carries, whatever its kind. */
export interface SeamBase {
  /** Stable id — assertion results and wave-gate gap strings cite it. */
  readonly id: string;
  /** Ticket that owns WRITING this seam, when the board knows it. */
  readonly provider_ticket?: string;
  /** Ticket that RELIES on this seam — wave-gate gaps are attributed to it. */
  readonly consumer_ticket?: string;
  /** Optional path of a contract test that must exist for the seam. */
  readonly contract_test?: string;
}

/** The existing `InterfaceRef` shape, lifted (see adapter.ts). */
export interface ExportSeam extends SeamBase {
  readonly kind: 'export';
  readonly packageName: string;
  readonly exportName: string;
  readonly wiring_evidence: ExportEvidence;
}

export interface RouteSeam extends SeamBase {
  readonly kind: 'route';
  readonly method: string;
  readonly path: string;
  readonly wiring_evidence: RouteEvidence;
}

export interface DbColumnSeam extends SeamBase {
  readonly kind: 'db-column';
  readonly table: string;
  readonly column: string;
  readonly wiring_evidence: GenericEvidence;
}

export interface DiBindingSeam extends SeamBase {
  readonly kind: 'di-binding';
  readonly token: string;
  readonly wiring_evidence: GenericEvidence;
}

export interface EventTopicSeam extends SeamBase {
  readonly kind: 'event-topic';
  readonly topic: string;
  readonly wiring_evidence: GenericEvidence;
}

export interface NavEntrySeam extends SeamBase {
  readonly kind: 'nav-entry';
  readonly label: string;
  readonly wiring_evidence: GenericEvidence;
}

export interface ConfigKeySeam extends SeamBase {
  readonly kind: 'config-key';
  readonly key: string;
  readonly wiring_evidence: GenericEvidence;
}

export interface FeatureFlagSeam extends SeamBase {
  readonly kind: 'feature-flag';
  readonly flag: string;
  readonly wiring_evidence: GenericEvidence;
}

/** The tagged union. Discriminate on `kind`. */
export type Seam =
  | ExportSeam
  | RouteSeam
  | DbColumnSeam
  | DiBindingSeam
  | EventTopicSeam
  | NavEntrySeam
  | ConfigKeySeam
  | FeatureFlagSeam;

/** One build-time assertion outcome (see assert.ts). `reason` is present
 * exactly when `ok` is false, and names the file plus what was missing. */
export interface SeamAssertion {
  readonly seamId: string;
  readonly ok: boolean;
  readonly reason?: string;
}
