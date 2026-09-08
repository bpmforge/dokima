/**
 * The security execution graph (W23-05, AB-05) — declared, not discovered.
 *
 * `SECURITY_STEPS` is an ORDERED LIST, and an order is not a dependency graph.
 * Reading it, you cannot tell whether `security-attack-chains` must wait for
 * `security-owasp-web` or merely happens to follow it, and the only way to
 * find out is to run the thing and watch. That is exactly the "hidden topology
 * discovered through fake execution" IMPLEMENTATION_PLAN §5 forbids for the
 * new concurrent path: the moment anything runs two of these at once, an order
 * that was documentation becomes a race.
 *
 * So the edges are stated. Stage A are the objective tool nodes W23-04 added
 * (`tool-*`, deliberately a different id namespace from the specialist steps —
 * a scanner's result and a model's interpretation of it are different
 * evidence). Stage B specialists depend on the tool whose output they read.
 * Stage C synthesis depends on every applicable B. Stage D refreshes the
 * threat model from C.
 *
 * APPLICABILITY IS A MEASUREMENT, AND ITS THIRD ANSWER IS "UNRESOLVED".
 * `not_applicable` requires a runtime-derived reason and the inventory digest
 * it was derived from; a project the runtime could not classify stays
 * REQUIRED, because "we could not tell whether this app talks to a cloud" is
 * not "this app does not talk to a cloud". A skipped category is never counted
 * as a passed scan, and the synthesis node is told which categories were
 * skipped and which were missing.
 *
 * This file is data and pure functions — the same no-fs, no-gateway discipline
 * `security-cluster.ts` and `onboard.ts` keep. The inventory it classifies from
 * is measured by the caller, which is the layer that may touch a filesystem.
 */

import { createHash } from 'node:crypto';

export type SecurityStage = 'A' | 'B' | 'C' | 'D';

export interface SecurityPlanNode {
  readonly id: string;
  readonly stage: SecurityStage;
  /** A tool node executes a scanner; a specialist node is a model reading one. */
  readonly kind: 'tool' | 'specialist';
  readonly dependsOn: readonly string[];
  /** The paths this node alone may write. Two nodes in one concurrent group may never share one. */
  readonly outputs: readonly string[];
  readonly role: string | null;
}

const TOOL_NODES: readonly SecurityPlanNode[] = [
  {
    id: 'tool-sast',
    stage: 'A',
    kind: 'tool',
    dependsOn: [],
    outputs: ['evidence/tool-sast.json'],
    role: null,
  },
  {
    id: 'tool-secrets',
    stage: 'A',
    kind: 'tool',
    dependsOn: [],
    outputs: ['evidence/tool-secrets.json'],
    role: null,
  },
  {
    id: 'tool-deps',
    stage: 'A',
    kind: 'tool',
    dependsOn: [],
    outputs: ['evidence/tool-deps.json'],
    role: null,
  },
];

const REPORT_NODES: readonly SecurityPlanNode[] = [
  {
    id: 'security-sast',
    stage: 'B',
    kind: 'specialist',
    dependsOn: ['tool-sast'],
    outputs: ['docs/security/SEMGREP_FINDINGS.md'],
    role: 'semgrep-runner',
  },
  {
    id: 'security-secrets',
    stage: 'B',
    kind: 'specialist',
    dependsOn: ['tool-secrets'],
    outputs: ['docs/security/SECRETS_FINDINGS.md'],
    role: 'secrets-scanner',
  },
  {
    id: 'security-deps',
    stage: 'B',
    kind: 'specialist',
    dependsOn: ['tool-deps'],
    outputs: ['docs/security/DEPENDENCY_FINDINGS.md'],
    role: 'dependency-auditor',
  },
];

/**
 * The contextual reviewers. They depend on ALL of stage A rather than on one
 * tool each: an OWASP judgement reads the SAST output, the secrets result and
 * the dependency picture together, and a reviewer given one third of the
 * evidence produces a confident third of an answer.
 */
const CONTEXTUAL_NODES: readonly SecurityPlanNode[] = [
  {
    id: 'security-owasp-web',
    stage: 'B',
    kind: 'specialist',
    dependsOn: ['tool-sast', 'tool-secrets', 'tool-deps'],
    outputs: ['docs/security/OWASP_WEB_FINDINGS.md'],
    role: 'owasp-web-checker',
  },
  {
    id: 'security-owasp-llm',
    stage: 'B',
    kind: 'specialist',
    dependsOn: ['tool-sast', 'tool-secrets', 'tool-deps'],
    outputs: ['docs/security/LLM_FINDINGS.md'],
    role: 'owasp-llm-checker',
  },
  {
    id: 'security-cloud',
    stage: 'B',
    kind: 'specialist',
    dependsOn: ['tool-sast', 'tool-secrets', 'tool-deps'],
    outputs: ['docs/security/CLOUD_FINDINGS.md'],
    role: 'cloud-security-checker',
  },
  {
    id: 'security-iac',
    stage: 'B',
    kind: 'specialist',
    dependsOn: ['tool-sast', 'tool-secrets', 'tool-deps'],
    outputs: ['docs/security/IAC_FINDINGS.md'],
    role: 'iac-security-checker',
  },
];

const SYNTHESIS: SecurityPlanNode = {
  id: 'security-attack-chains',
  stage: 'C',
  kind: 'specialist',
  dependsOn: [...REPORT_NODES, ...CONTEXTUAL_NODES].map((n) => n.id),
  outputs: ['docs/security/ATTACK_CHAINS.md'],
  role: 'attack-chainer',
};

const REFRESH: SecurityPlanNode = {
  id: 'threat-model-refresh',
  stage: 'D',
  kind: 'specialist',
  dependsOn: ['security-attack-chains'],
  outputs: ['docs/THREAT_MODEL.md'],
  role: 'threat-modeler',
};

export const SECURITY_PLAN: readonly SecurityPlanNode[] = Object.freeze([
  ...TOOL_NODES,
  ...REPORT_NODES,
  ...CONTEXTUAL_NODES,
  SYNTHESIS,
  REFRESH,
]);

/** What the runtime measured about the project. Every field is an observation, never an inference from a name. */
export interface SecurityInventory {
  /** Null means the runtime could not tell — which is NOT the same as false. */
  readonly servesHttp: boolean | null;
  readonly integratesLlm: boolean | null;
  readonly usesCloudSdk: boolean | null;
  readonly hasInfrastructureAsCode: boolean | null;
  /** The file list the answers above were derived from; digested into every verdict. */
  readonly inventoryPaths: readonly string[];
}

export type ApplicabilityStatus = 'applicable' | 'not_applicable' | 'unresolved';

export interface NodeApplicability {
  readonly nodeId: string;
  readonly status: ApplicabilityStatus;
  readonly reason: string | null;
  readonly inventoryDigest: string;
}

export function inventoryDigest(inventory: SecurityInventory): string {
  const canonical = JSON.stringify({
    servesHttp: inventory.servesHttp,
    integratesLlm: inventory.integratesLlm,
    usesCloudSdk: inventory.usesCloudSdk,
    hasInfrastructureAsCode: inventory.hasInfrastructureAsCode,
    paths: [...inventory.inventoryPaths].sort(),
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

/**
 * The one place a category may be skipped. Three outcomes, and the third is
 * the point: an observation of `null` — the runtime could not classify this
 * project — leaves the node UNRESOLVED, which callers must treat as required.
 * Silently skipping what you could not measure is how a scan nobody ran
 * becomes a clean security result.
 */
export function classifySecurityApplicability(
  inventory: SecurityInventory,
): readonly NodeApplicability[] {
  const digest = inventoryDigest(inventory);
  const from = (
    nodeId: string,
    observed: boolean | null,
    absentReason: string,
  ): NodeApplicability => {
    if (observed === null) {
      return {
        nodeId,
        status: 'unresolved',
        reason:
          'the runtime could not classify this surface, so the check stays required',
        inventoryDigest: digest,
      };
    }
    return observed
      ? { nodeId, status: 'applicable', reason: null, inventoryDigest: digest }
      : {
          nodeId,
          status: 'not_applicable',
          reason: absentReason,
          inventoryDigest: digest,
        };
  };

  return SECURITY_PLAN.map((node) => {
    switch (node.id) {
      case 'security-owasp-web':
        return from(
          node.id,
          inventory.servesHttp,
          `no HTTP-serving surface was found among the ${inventory.inventoryPaths.length} inventoried paths`,
        );
      case 'security-owasp-llm':
        return from(
          node.id,
          inventory.integratesLlm,
          'no LLM provider or SDK usage was found in the inventory',
        );
      case 'security-cloud':
        return from(
          node.id,
          inventory.usesCloudSdk,
          'no cloud provider SDK was found in the inventory',
        );
      case 'security-iac':
        return from(
          node.id,
          inventory.hasInfrastructureAsCode,
          'no infrastructure-as-code files were found in the inventory',
        );
      default:
        // Tool nodes, the three report specialists, synthesis and the refresh
        // are unconditional. There is no project shape that makes "did anyone
        // commit a credential" an inapplicable question.
        return {
          nodeId: node.id,
          status: 'applicable',
          reason: null,
          inventoryDigest: digest,
        };
    }
  });
}

/**
 * Structural validation, run BEFORE any model or tool call (AB-05 step 5). A
 * cycle or a dangling predecessor discovered mid-run is a race that has
 * already started; discovered here it is a refusal that cost nothing.
 */
export function validateSecurityPlan(
  plan: readonly SecurityPlanNode[] = SECURITY_PLAN,
): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const node of plan) {
    if (seen.has(node.id)) errors.push(`duplicate node id ${node.id}`);
    seen.add(node.id);
  }
  for (const node of plan) {
    for (const dep of node.dependsOn) {
      if (!seen.has(dep)) errors.push(`${node.id} depends on unknown node ${dep}`);
    }
  }

  // Cycles, by colour-marked depth-first search — the same shape
  // `scripts/validate-plan.mjs` uses on the ticket board.
  const byId = new Map(plan.map((n) => [n.id, n]));
  const colour = new Map<string, 'grey' | 'black'>();
  const walk = (id: string, path: readonly string[]): void => {
    colour.set(id, 'grey');
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dep)) continue;
      if (colour.get(dep) === 'grey')
        errors.push(`cycle: ${[...path, id, dep].join(' -> ')}`);
      else if (!colour.has(dep)) walk(dep, [...path, id]);
    }
    colour.set(id, 'black');
  };
  for (const node of plan) if (!colour.has(node.id)) walk(node.id, []);

  // Exclusive output scopes: two nodes that can be in flight together must
  // never write the same path.
  const owner = new Map<string, string>();
  for (const node of plan) {
    for (const output of node.outputs) {
      const existing = owner.get(output);
      if (existing) errors.push(`${node.id} and ${existing} both write ${output}`);
      else owner.set(output, node.id);
    }
  }

  return errors;
}

/**
 * The nodes that may start now: every predecessor has produced a result, or is
 * a documented NOT_APPLICABLE. An UNRESOLVED predecessor does NOT satisfy a
 * dependency — it is required, and required means waited for.
 */
export function readySecurityNodes(
  completed: ReadonlySet<string>,
  applicability: readonly NodeApplicability[],
  plan: readonly SecurityPlanNode[] = SECURITY_PLAN,
): readonly string[] {
  const statusOf = new Map(applicability.map((a) => [a.nodeId, a.status]));
  const satisfied = (id: string): boolean =>
    completed.has(id) || statusOf.get(id) === 'not_applicable';
  return plan
    .filter((node) => !completed.has(node.id))
    .filter((node) => statusOf.get(node.id) !== 'not_applicable')
    .filter((node) => node.dependsOn.every(satisfied))
    .map((node) => node.id);
}

/**
 * What the synthesis node must be told. Attack-chain synthesis that does not
 * know a category was skipped will read its absence as an absence of findings,
 * which is the difference between "no cloud misconfiguration" and "nobody
 * looked at the cloud".
 */
export function skippedCategories(
  applicability: readonly NodeApplicability[],
): readonly { readonly nodeId: string; readonly reason: string }[] {
  return applicability
    .filter((a) => a.status === 'not_applicable')
    .map((a) => ({ nodeId: a.nodeId, reason: a.reason ?? 'no reason recorded' }));
}
