/**
 * Fitness card store, keyed (model, role, harnessVersion) per
 * docs/DATABASE.md §7's model_fitness PK. Optionally backed by the fleet
 * registry (`~/.shipwright/global.db`, `@shipwright/events`'s
 * `global-db` module): when a `GlobalDb` handle is passed in, every read
 * and write goes straight through SQLite (better-sqlite3 is synchronous —
 * TECH_STACK.md — so there is no async/cache-staleness split to manage);
 * with no handle, the store falls back to the original in-memory Map so
 * every existing no-arg call site (assignment.ts's tests, bench callers
 * with no DB wired up yet) keeps working unchanged.
 */

import {
  getModelFitness,
  listModelFitness,
  putModelFitness,
  type GlobalDb,
  type ModelFitnessRecord,
} from '@shipwright/events';
import type { AgentRole, FitnessCard } from './types.js';

function cardKey(model: string, role: AgentRole, harnessVersion: string): string {
  return `${model}::${role}::${harnessVersion}`;
}

function toRecord(card: FitnessCard): ModelFitnessRecord {
  return {
    model: card.model,
    role: card.role,
    verdict: card.verdict,
    harnessVersion: card.harnessVersion,
    receiptPayload: card.taskResults,
    runAt: card.runAt,
  };
}

function toCard(record: ModelFitnessRecord): FitnessCard {
  return {
    model: record.model,
    role: record.role,
    verdict: record.verdict,
    harnessVersion: record.harnessVersion,
    taskResults: record.receiptPayload as FitnessCard['taskResults'],
    runAt: record.runAt,
  };
}

export class FitnessCardStore {
  private readonly cards = new Map<string, FitnessCard>();
  private readonly global?: GlobalDb;

  constructor(global?: GlobalDb) {
    this.global = global;
  }

  put(card: FitnessCard): void {
    if (this.global) {
      putModelFitness(this.global, toRecord(card));
      return;
    }
    this.cards.set(cardKey(card.model, card.role, card.harnessVersion), card);
  }

  get(model: string, role: AgentRole, harnessVersion: string): FitnessCard | undefined {
    if (this.global) {
      const record = getModelFitness(this.global, model, role, harnessVersion);
      return record ? toCard(record) : undefined;
    }
    return this.cards.get(cardKey(model, role, harnessVersion));
  }

  all(): readonly FitnessCard[] {
    if (this.global) {
      return listModelFitness(this.global).map(toCard);
    }
    return [...this.cards.values()];
  }
}
