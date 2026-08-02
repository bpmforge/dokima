import { describe, expect, it } from 'vitest';
import { sortByAttention } from './sort.js';
import type { ProjectCard } from './types.js';

function card(overrides: Partial<ProjectCard>): ProjectCard {
  return {
    id: overrides.id ?? 'p',
    path: '/tmp/p',
    name: overrides.id ?? 'p',
    archived: false,
    available: true,
    createdAt: '2026-01-01T00:00:00Z',
    lastOpenedAt: '2026-01-01T00:00:00Z',
    phase: null,
    board: { ready: 0, blocked: 0, done: 0 },
    berthsRunning: 0,
    heartbeatAgeMs: null,
    pendingDecideCount: 0,
    spendTodayUsd: 0,
    ...overrides,
  };
}

describe('sortByAttention', () => {
  it('sorts by pending Decide count, descending', () => {
    const cards = [
      card({ id: 'low', pendingDecideCount: 1 }),
      card({ id: 'high', pendingDecideCount: 5 }),
    ];
    expect(sortByAttention(cards).map((c) => c.id)).toEqual(['high', 'low']);
  });

  it('breaks ties on the stalest heartbeat first', () => {
    const cards = [
      card({ id: 'fresh', pendingDecideCount: 0, heartbeatAgeMs: 1_000 }),
      card({ id: 'stale', pendingDecideCount: 0, heartbeatAgeMs: 60_000 }),
    ];
    expect(sortByAttention(cards).map((c) => c.id)).toEqual(['stale', 'fresh']);
  });

  it('treats a null heartbeat (no active berth) as freshest among ties', () => {
    const cards = [
      card({ id: 'idle', pendingDecideCount: 0, heartbeatAgeMs: null }),
      card({ id: 'running', pendingDecideCount: 0, heartbeatAgeMs: 5_000 }),
    ];
    expect(sortByAttention(cards).map((c) => c.id)).toEqual(['running', 'idle']);
  });

  it('does not mutate the input array', () => {
    const cards = [
      card({ id: 'a', pendingDecideCount: 0 }),
      card({ id: 'b', pendingDecideCount: 5 }),
    ];
    const original = [...cards];
    sortByAttention(cards);
    expect(cards).toEqual(original);
  });
});
