/**
 * Local shapes for the onboard/analysis wiring (W8-09). A specialist's real
 * completion (via `./onboard-dispatch-port.js`) is untrusted model output —
 * defensively parsed into `OnboardFinding[]` the same way `gateway-model-port.ts`
 * parses the creation-pipeline's completions (`./json-shape.js` helpers,
 * `MalformedModelOutputError` on a bad shape). Nothing here trusts a
 * specialist's claim about ticket/plan state (Law 4) — a finding is just a
 * title/severity/recommendation triple; becoming a board item is entirely
 * `./onboard-board-lifecycle.js`'s job, through `proposeFromMatches`/
 * `acceptItem`, never read off this shape directly.
 */
import { requireArray, requireObject, requireString } from './json-shape.js';
import { MalformedModelOutputError } from './errors.js';

export type OnboardFindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const SEVERITIES: readonly OnboardFindingSeverity[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
];

/** One specialist-reported finding — never carries a state/ticketId/signer field:
 * the JSON shape below has no such fields, so a compromised completion has
 * nowhere to smuggle a forged lifecycle claim (AC3a). */
export interface OnboardFinding {
  readonly title: string;
  readonly severity: OnboardFindingSeverity;
  readonly recommendation: string;
  /** A predicate/command string the specialist proposes as its own "done" check —
   * carried verbatim into the board ticket's `verify` (same documented
   * plan_item/ticket verify-field collapse `board-lifecycle.ts`'s header
   * already flags for decomposed tickets; not fixed here, not new here). */
  readonly verify: string;
}

/** One step's full artifact — everything `dispatch` returns for a role. */
export interface OnboardStepArtifact {
  readonly stepId: string;
  readonly role: string;
  readonly summary: string;
  readonly findings: readonly OnboardFinding[];
  /** Real `runSession` result metadata (never the manifest content itself,
   * which is model-authored and untrusted) — exit code + write-scope
   * violations observed via real `git diff`, for audit. */
  readonly session: {
    readonly exitCode: number | null;
    readonly scopeViolations: readonly string[];
  };
}

function parseSeverity(
  value: unknown,
  phase: string,
  path: string,
): OnboardFindingSeverity {
  const str = requireString(value, phase, path);
  if (!SEVERITIES.includes(str as OnboardFindingSeverity)) {
    throw new MalformedModelOutputError(
      phase,
      `"${path}" must be one of ${SEVERITIES.join('|')}, got "${str}"`,
    );
  }
  return str as OnboardFindingSeverity;
}

/** Defensively parses one specialist completion's raw JSON body into
 * `{ summary, findings }` — throws `MalformedModelOutputError` (same class
 * `gateway-model-port.ts` uses) on any shape mismatch, never guesses. */
export function parseOnboardCompletion(
  raw: unknown,
  phase: string,
): { readonly summary: string; readonly findings: readonly OnboardFinding[] } {
  const body = requireObject(raw, phase, '<response>');
  const summary = requireString(body.summary, phase, 'summary');
  const findings = requireArray(body.findings, phase, 'findings').map((f, i) => {
    const finding = requireObject(f, phase, `findings[${i}]`);
    return {
      title: requireString(finding.title, phase, `findings[${i}].title`),
      severity: parseSeverity(finding.severity, phase, `findings[${i}].severity`),
      recommendation: requireString(
        finding.recommendation,
        phase,
        `findings[${i}].recommendation`,
      ),
      verify: requireString(finding.verify, phase, `findings[${i}].verify`),
    };
  });
  return { summary, findings };
}
