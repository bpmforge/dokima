/**
 * W23-05. The graph is asserted against the EXISTING step ids, because a plan
 * that names steps nobody runs is a second topology rather than a declaration
 * of the one that exists.
 */

import { describe, expect, it } from 'vitest';
import {
  SECURITY_PLAN,
  classifySecurityApplicability,
  inventoryDigest,
  skippedCategories,
  validateSecurityPlan,
  type SecurityInventory,
  type SecurityPlanNode,
} from './security-plan.js';
import { SECURITY_CLUSTER_STEPS, THREAT_MODEL_REFRESH_STEP } from './security-cluster.js';

const FULL: SecurityInventory = {
  servesHttp: true,
  integratesLlm: true,
  usesCloudSdk: true,
  hasInfrastructureAsCode: true,
  inventoryPaths: ['src/server.ts', 'infra/main.tf'],
};

const applicableIds = (inventory: SecurityInventory): string[] =>
  classifySecurityApplicability(inventory)
    .filter((a) => a.status === 'applicable')
    .map((a) => a.nodeId);

describe('the graph is declared, and it is structurally sound', () => {
  it('validates clean: unique ids, known predecessors, no cycles, no shared outputs', () => {
    expect(validateSecurityPlan()).toEqual([]);
  });

  it('covers every existing security step id, and adds tool nodes in their own namespace', () => {
    const planIds = new Set(SECURITY_PLAN.map((n) => n.id));
    for (const step of SECURITY_CLUSTER_STEPS) expect(planIds.has(step.id)).toBe(true);
    expect(planIds.has(THREAT_MODEL_REFRESH_STEP.id)).toBe(true);
    // The objective tool nodes must not collide with the specialist ids: a
    // scanner's result and a model's reading of it are different evidence.
    const toolIds = SECURITY_PLAN.filter((n) => n.kind === 'tool').map((n) => n.id);
    expect(toolIds).toEqual(['tool-sast', 'tool-secrets', 'tool-deps']);
    for (const id of toolIds) {
      expect(SECURITY_CLUSTER_STEPS.some((s) => s.id === id)).toBe(false);
    }
  });

  it('synthesis waits for every stage-B specialist, and the refresh waits for synthesis', () => {
    const chains = SECURITY_PLAN.find((n) => n.id === 'security-attack-chains')!;
    const stageB = SECURITY_PLAN.filter((n) => n.stage === 'B').map((n) => n.id);
    expect([...chains.dependsOn].sort()).toEqual([...stageB].sort());
    const refresh = SECURITY_PLAN.find((n) => n.id === 'threat-model-refresh')!;
    expect(refresh.dependsOn).toEqual(['security-attack-chains']);
  });

  it('each report specialist waits for the tool whose output it reads', () => {
    const dep = (id: string): readonly string[] =>
      SECURITY_PLAN.find((n) => n.id === id)!.dependsOn;
    expect(dep('security-sast')).toEqual(['tool-sast']);
    expect(dep('security-secrets')).toEqual(['tool-secrets']);
    expect(dep('security-deps')).toEqual(['tool-deps']);
  });

  it.each([
    [
      'a cycle',
      [
        {
          id: 'a',
          stage: 'B',
          kind: 'specialist',
          dependsOn: ['b'],
          outputs: ['a.md'],
          role: null,
        },
        {
          id: 'b',
          stage: 'B',
          kind: 'specialist',
          dependsOn: ['a'],
          outputs: ['b.md'],
          role: null,
        },
      ],
      /cycle/,
    ],
    [
      'a dangling predecessor',
      [
        {
          id: 'a',
          stage: 'B',
          kind: 'specialist',
          dependsOn: ['ghost'],
          outputs: ['a.md'],
          role: null,
        },
      ],
      /unknown node ghost/,
    ],
    [
      'two writers of one output',
      [
        {
          id: 'a',
          stage: 'B',
          kind: 'specialist',
          dependsOn: [],
          outputs: ['same.md'],
          role: null,
        },
        {
          id: 'b',
          stage: 'B',
          kind: 'specialist',
          dependsOn: [],
          outputs: ['same.md'],
          role: null,
        },
      ],
      /both write same.md/,
    ],
    [
      'a duplicate id',
      [
        {
          id: 'a',
          stage: 'B',
          kind: 'specialist',
          dependsOn: [],
          outputs: ['a.md'],
          role: null,
        },
        {
          id: 'a',
          stage: 'B',
          kind: 'specialist',
          dependsOn: [],
          outputs: ['b.md'],
          role: null,
        },
      ],
      /duplicate node id a/,
    ],
  ])('RED FIXTURE: %s is caught before anything runs', (_name, nodes, pattern) => {
    const errors = validateSecurityPlan(nodes as unknown as readonly SecurityPlanNode[]);
    expect(errors.join(' | ')).toMatch(pattern as RegExp);
  });
});

describe('applicability is measured, and its third answer is "we could not tell"', () => {
  it('an absent surface is NOT_APPLICABLE with a reason and the inventory digest', () => {
    const inventory: SecurityInventory = { ...FULL, hasInfrastructureAsCode: false };
    const iac = classifySecurityApplicability(inventory).find(
      (a) => a.nodeId === 'security-iac',
    )!;
    expect(iac.status).toBe('not_applicable');
    expect(iac.reason).toMatch(/no infrastructure-as-code files/);
    expect(iac.inventoryDigest).toBe(inventoryDigest(inventory));
  });

  it('RED FIXTURE: an UNCLASSIFIABLE surface stays required — never silently skipped', () => {
    const inventory: SecurityInventory = { ...FULL, usesCloudSdk: null };
    const cloud = classifySecurityApplicability(inventory).find(
      (a) => a.nodeId === 'security-cloud',
    )!;
    expect(cloud.status).toBe('unresolved');
    expect(cloud.status).not.toBe('not_applicable');
    expect(cloud.reason).toMatch(/stays required/);
  });

  it('nothing about a project can make a secrets scan inapplicable', () => {
    const nothing: SecurityInventory = {
      servesHttp: false,
      integratesLlm: false,
      usesCloudSdk: false,
      hasInfrastructureAsCode: false,
      inventoryPaths: [],
    };
    expect(applicableIds(nothing)).toContain('security-secrets');
    expect(applicableIds(nothing)).toContain('tool-secrets');
  });

  it('the synthesis node can be told exactly which categories were skipped, and why', () => {
    const skipped = skippedCategories(
      classifySecurityApplicability({
        ...FULL,
        usesCloudSdk: false,
        integratesLlm: false,
      }),
    );
    expect(skipped.map((s) => s.nodeId).sort()).toEqual([
      'security-cloud',
      'security-owasp-llm',
    ]);
    for (const entry of skipped) expect(entry.reason).not.toBe('no reason recorded');
  });
});
