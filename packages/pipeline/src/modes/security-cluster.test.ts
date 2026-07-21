import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SECURITY_CLUSTER_STEPS,
  SECURITY_SPECIALIST_ROLES,
  SECURITY_STEPS,
  THREAT_MODEL_REFRESH_STEP,
} from './security-cluster.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPERTS_DIR = path.resolve(HERE, '../../../../content/experts');

function findExpertFile(role: string): string | undefined {
  const stack = [EXPERTS_DIR];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === `${role}.md`) return full;
    }
  }
  return undefined;
}

describe('SECURITY_STEPS (W8-08 AC1: security-cluster + threat-model-refresh topology)', () => {
  it('every named specialist role exists as a real content/experts file', () => {
    for (const role of SECURITY_SPECIALIST_ROLES) {
      const found = findExpertFile(role);
      expect(found, `content/experts/**/${role}.md should exist`).toBeDefined();
      expect(existsSync(found ?? '')).toBe(true);
    }
  });

  it('every step has exactly one producing role across its deliverables', () => {
    for (const step of SECURITY_STEPS) {
      const roles = new Set(step.deliverables.map((d) => d.producingRole));
      expect(roles.size, `step ${step.id} should have one producing role`).toBe(1);
    }
  });

  it('threat-model-refresh is the last step, after every security-cluster step', () => {
    expect(SECURITY_STEPS[SECURITY_STEPS.length - 1]).toBe(THREAT_MODEL_REFRESH_STEP);
    expect(SECURITY_STEPS.slice(0, -1)).toEqual(SECURITY_CLUSTER_STEPS);
  });

  it('threat-model-refresh refreshes the canonical docs/THREAT_MODEL.md, not a dated finding file', () => {
    expect(THREAT_MODEL_REFRESH_STEP.deliverables).toEqual([
      { id: 'docs/THREAT_MODEL.md', producingRole: 'threat-modeler' },
    ]);
  });

  it('attack-chainer runs last within the cluster (reads the other findings)', () => {
    const last = SECURITY_CLUSTER_STEPS[SECURITY_CLUSTER_STEPS.length - 1];
    expect(last?.deliverables[0]?.producingRole).toBe('attack-chainer');
  });

  it('step ids are unique', () => {
    const ids = SECURITY_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
