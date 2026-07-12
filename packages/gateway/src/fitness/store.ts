/**
 * In-memory fitness card store, keyed (model, role, harnessVersion) per
 * docs/DATABASE.md §7's model_fitness PK. Mirrors budget/ledger.ts's
 * in-memory-store-behind-a-class shape: this package cannot depend on
 * packages/events' SQLite-backed store from this ticket's write_scope
 * (packages/gateway/src/fitness/** only), so persistence is an injection
 * point for whichever future ticket owns the global fitness DB.
 */

import type { AgentRole, FitnessCard } from './types.js';

function cardKey(model: string, role: AgentRole, harnessVersion: string): string {
  return `${model}::${role}::${harnessVersion}`;
}

export class FitnessCardStore {
  private readonly cards = new Map<string, FitnessCard>();

  put(card: FitnessCard): void {
    this.cards.set(cardKey(card.model, card.role, card.harnessVersion), card);
  }

  get(model: string, role: AgentRole, harnessVersion: string): FitnessCard | undefined {
    return this.cards.get(cardKey(model, role, harnessVersion));
  }

  all(): readonly FitnessCard[] {
    return [...this.cards.values()];
  }
}
