/**
 * Security-cluster + threat-model-refresh step topology (W8-08 AC1),
 * added alongside `onboard.ts`'s `ONBOARD_STEPS` rather than into it —
 * `ONBOARD_MODE` (registry.ts, coverage-loop.ts) already has committed
 * semantics (macroLoopCap, coverage rows) keyed off the exact four AC1
 * categories; this module is a second, independent static topology that
 * `run/run-onboard.ts` appends after `ONBOARD_STEPS` when it builds the
 * onboard *run*'s step list. Same shape and same no-fs/no-gateway
 * discipline as `onboard.ts` — this file is data, not an executor.
 *
 * Each step here is single-specialist (one `producingRole` per step),
 * mirroring the invariant `onboard.test.ts` already checks for
 * `ONBOARD_STEPS` (every deliverable in a step shares one producing role) —
 * `run-onboard.ts`'s executor dispatches once per step, so a step with
 * mixed roles would have nowhere to route the artifact.
 *
 * Roles are the nine content/experts/security specialists (content/experts/
 * security/*.md, minus the two *_METHODOLOGY.md reference docs): semgrep-
 * runner (Phase 1 of any scan per its own description — ordered first),
 * secrets-scanner, dependency-auditor, owasp-web-checker, owasp-llm-checker,
 * cloud-security-checker, iac-security-checker, attack-chainer (reads the
 * other findings, so ordered last in the cluster — its own Input Contract
 * lists SEMGREP_FINDINGS/OWASP_WEB_FINDINGS as required context), and
 * threat-modeler (its own description: "Runs after semgrep-runner so it can
 * reference confirmed findings when rating threats" — ordered last overall,
 * after the whole cluster, as the "refresh" step). All nine WRITE-SCOPE to
 * `docs/security/` per their Input Contract tables except threat-modeler,
 * whose deliverable is the canonical `docs/THREAT_MODEL.md` (the same path
 * `phases/topology.ts`'s phase-3 table already uses for this role) since a
 * *refresh* updates the project's one design-phase threat model rather than
 * writing a dated one-off finding file.
 */
import type { Deliverable } from '../phases/types.js';
import type { ModeStep } from './types.js';

function deliverable(id: string, producingRole: string): Deliverable {
  return { id, producingRole };
}

function step(id: string, name: string, deliverables: readonly Deliverable[]): ModeStep {
  return { id, name, deliverables };
}

/** The eight security-cluster specialists (BLUEPRINT dogfood note, ROADMAP.md
 * W8: "runs its own security cluster") — every content/experts/security/*.md
 * specialist except threat-modeler, which is the separate refresh step below. */
export const SECURITY_CLUSTER_SPECIALIST_ROLES = [
  'semgrep-runner',
  'secrets-scanner',
  'dependency-auditor',
  'owasp-web-checker',
  'owasp-llm-checker',
  'cloud-security-checker',
  'iac-security-checker',
  'attack-chainer',
] as const;

export const SECURITY_CLUSTER_STEPS: readonly ModeStep[] = [
  step('security-sast', 'Static Analysis (Semgrep)', [
    deliverable('docs/security/SEMGREP_FINDINGS.md', 'semgrep-runner'),
  ]),
  step('security-secrets', 'Secrets Scan', [
    deliverable('docs/security/SECRETS_FINDINGS.md', 'secrets-scanner'),
  ]),
  step('security-deps', 'Dependency Audit', [
    deliverable('docs/security/DEPENDENCY_FINDINGS.md', 'dependency-auditor'),
  ]),
  step('security-owasp-web', 'OWASP Web Top 10', [
    deliverable('docs/security/OWASP_WEB_FINDINGS.md', 'owasp-web-checker'),
  ]),
  step('security-owasp-llm', 'OWASP LLM Top 10', [
    deliverable('docs/security/LLM_FINDINGS.md', 'owasp-llm-checker'),
  ]),
  step('security-cloud', 'Cloud Security', [
    deliverable('docs/security/CLOUD_FINDINGS.md', 'cloud-security-checker'),
  ]),
  step('security-iac', 'IaC Security', [
    deliverable('docs/security/IAC_FINDINGS.md', 'iac-security-checker'),
  ]),
  step('security-attack-chains', 'Attack Chain Synthesis', [
    deliverable('docs/security/ATTACK_CHAINS.md', 'attack-chainer'),
  ]),
];

export const THREAT_MODEL_REFRESH_STEP: ModeStep = step(
  'threat-model-refresh',
  'Threat Model Refresh',
  [deliverable('docs/THREAT_MODEL.md', 'threat-modeler')],
);

/** The full topology this ticket adds "alongside" `ONBOARD_STEPS` — cluster
 * steps first (attack-chainer last within the cluster, reading the other
 * findings), threat-model-refresh last overall. */
export const SECURITY_STEPS: readonly ModeStep[] = [
  ...SECURITY_CLUSTER_STEPS,
  THREAT_MODEL_REFRESH_STEP,
];

export const SECURITY_SPECIALIST_ROLES = [
  ...SECURITY_CLUSTER_SPECIALIST_ROLES,
  'threat-modeler',
] as const;
