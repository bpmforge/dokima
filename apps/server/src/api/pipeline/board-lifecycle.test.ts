import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openEventLog } from '@shipwright/events';
import { getTicket as getBoardTicket } from '@shipwright/tickets';
import type { DecomposedPlan, DecomposedTicket } from '@shipwright/pipeline';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acceptDecomposedPlanItems,
  persistDecomposedPlan,
  proposePlanItemsFromDecomposedPlan,
} from './board-lifecycle.js';
import { listPlanItems } from '../plans-store.js';
import { stateDbPath } from '../server/board-project.js';

async function tmpProjectDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-board-lifecycle-'));
}

function fixtureTicket(overrides: Partial<DecomposedTicket> = {}): DecomposedTicket {
  return {
    id: 'W-DEMO-1',
    type: 'task',
    title: 'Wire the demo feature',
    lane: 'demo',
    writeScope: ['apps/demo/**'],
    dependsOn: [],
    acceptance: [{ id: 'W-DEMO-1-AC1', text: 'It works', done: false }],
    verify: 'pnpm test',
    ...overrides,
  };
}

function fixturePlan(tickets: readonly DecomposedTicket[]): DecomposedPlan {
  return { tickets, violations: [], mermaid: 'graph TD;' };
}

describe('board-lifecycle — decompose output through the plans lifecycle', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('proposes one plan_items row per decomposed ticket, idempotent on catalogId', async () => {
    const projectDir = await tmpProjectDir();
    dirs.push(projectDir);
    const plan = fixturePlan([fixtureTicket()]);

    const first = await proposePlanItemsFromDecomposedPlan(projectDir, plan, {
      runId: 'run-1',
    });
    expect(first.created).toHaveLength(1);
    expect(first.created[0]?.catalogId).toBe('W-DEMO-1');
    expect(first.created[0]?.state).toBe('proposed');

    const second = await proposePlanItemsFromDecomposedPlan(projectDir, plan, {
      runId: 'run-2',
    });
    expect(second.created).toHaveLength(0);

    const { items } = await listPlanItems(projectDir);
    expect(items).toHaveLength(1);
  });

  it('accepts every proposed item via the real acceptPlanItem, minting a board ticket with the PLAN- id', async () => {
    const projectDir = await tmpProjectDir();
    dirs.push(projectDir);
    const plan = fixturePlan([fixtureTicket()]);

    const { created } = await proposePlanItemsFromDecomposedPlan(projectDir, plan, {
      runId: 'run-1',
    });
    const accepted = await acceptDecomposedPlanItems(projectDir, created, plan);

    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.ticketCreated).toBe(true);
    expect(accepted[0]?.item.state).toBe('accepted');
    expect(accepted[0]?.item.ticketId).toBe('PLAN-W-DEMO-1');

    const db = openEventLog(stateDbPath(projectDir));
    try {
      const ticket = getBoardTicket(db, 'PLAN-W-DEMO-1');
      expect(ticket).toBeDefined();
      expect(ticket?.lane).toBe('demo');
      expect(ticket?.writeScope).toEqual(['apps/demo/**']);
      expect(ticket?.type).toBe('task');
    } finally {
      db.close();
    }
  });

  it('rewrites dependsOn references with the same PLAN- prefix so the DAG stays consistent', async () => {
    const projectDir = await tmpProjectDir();
    dirs.push(projectDir);
    const upstream = fixtureTicket({ id: 'W-A', title: 'Upstream' });
    const downstream = fixtureTicket({
      id: 'W-B',
      title: 'Downstream',
      dependsOn: ['W-A'],
    });
    const plan = fixturePlan([upstream, downstream]);

    const accepted = await persistDecomposedPlan(projectDir, plan, { runId: 'run-1' });
    expect(accepted).toHaveLength(2);

    const db = openEventLog(stateDbPath(projectDir));
    try {
      const downstreamTicket = getBoardTicket(db, 'PLAN-W-B');
      expect(downstreamTicket?.dependsOn).toEqual(['PLAN-W-A']);
    } finally {
      db.close();
    }
  });

  it('collapses every decomposed type to the board ticket type "task" (documented acceptItem limitation)', async () => {
    const projectDir = await tmpProjectDir();
    dirs.push(projectDir);
    const plan = fixturePlan([fixtureTicket({ id: 'W-EPIC', type: 'epic' })]);

    await persistDecomposedPlan(projectDir, plan, { runId: 'run-1' });

    const db = openEventLog(stateDbPath(projectDir));
    try {
      const ticket = getBoardTicket(db, 'PLAN-W-EPIC');
      expect(ticket?.type).toBe('task');
    } finally {
      db.close();
    }
  });
});
