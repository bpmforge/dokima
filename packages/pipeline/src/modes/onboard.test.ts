import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ONBOARD_MODE,
  ONBOARD_SPECIALIST_ROLES,
  ONBOARD_STEPS,
  REQUIRED_ONBOARD_ARTIFACTS,
} from './onboard.js';

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

describe('ONBOARD_MODE', () => {
  it('R-B5: macro coverage-loop cap is 3', () => {
    expect(ONBOARD_MODE.macroLoopCap).toBe(3);
  });

  it('FR-P5 AC1: covers landscape, entry points, components, and health as named steps', () => {
    const stepIds = ONBOARD_STEPS.map((s) => s.id);
    expect(stepIds).toEqual(
      expect.arrayContaining(['landscape', 'entry-points', 'components', 'health']),
    );
  });

  it('every one of the four imported onboard specialists exists as a real content/experts file', () => {
    for (const role of ONBOARD_SPECIALIST_ROLES) {
      const found = findExpertFile(role);
      expect(found, `content/experts/**/${role}.md should exist`).toBeDefined();
      expect(existsSync(found ?? '')).toBe(true);
    }
  });

  it("every step whose id is one of the four AC1 categories is produced by that category's named specialist", () => {
    const byId = new Map(ONBOARD_STEPS.map((s) => [s.id, s]));
    expect(
      byId
        .get('landscape')
        ?.deliverables.every((d) => d.producingRole === 'landscape-mapper'),
    ).toBe(true);
    expect(
      byId
        .get('entry-points')
        ?.deliverables.every((d) => d.producingRole === 'entry-point-tracer'),
    ).toBe(true);
    expect(
      byId
        .get('components')
        ?.deliverables.every((d) => d.producingRole === 'component-mapper'),
    ).toBe(true);
    expect(
      byId
        .get('health')
        ?.deliverables.every((d) => d.producingRole === 'health-coordinator'),
    ).toBe(true);
  });

  it('every REQUIRED_ONBOARD_ARTIFACTS id is actually produced by some ONBOARD_STEPS deliverable', () => {
    const produced = new Set(
      ONBOARD_STEPS.flatMap((s) => s.deliverables.map((d) => d.id)),
    );
    for (const artifact of REQUIRED_ONBOARD_ARTIFACTS) {
      expect(
        produced.has(artifact),
        `${artifact} should be produced by an onboard step`,
      ).toBe(true);
    }
  });
});
