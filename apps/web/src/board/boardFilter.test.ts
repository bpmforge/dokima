import { describe, expect, it } from 'vitest';
import {
  boardFilterStorageKey,
  countByFilter,
  filterTickets,
  initialBoardFilter,
  parseBoardFilter,
  readStoredBoardFilter,
  writeStoredBoardFilter,
} from './boardFilter.js';
import { groupIntoLanes } from './lanes.js';
import { makeBoardTicket } from './test-helpers.js';

const parked = makeBoardTicket({
  id: 'P-1',
  status: 'ready',
  history: [
    {
      verb: 'comment',
      actorId: 'loop',
      at: 't',
      body: 'Parked with evidence — cap reached',
    },
  ],
});
const tickets = [
  makeBoardTicket({ id: 'R-1', status: 'ready', lane: 'api' }),
  parked,
  makeBoardTicket({ id: 'B-1', status: 'blocked', lane: 'api' }),
  makeBoardTicket({ id: 'B-2', status: 'blocked', lane: 'ui' }),
  makeBoardTicket({ id: 'V-1', status: 'in_review', lane: 'ui' }),
  makeBoardTicket({ id: 'D-1', status: 'done', lane: 'docs' }),
];

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

function throwingStorage(): Storage {
  const boom = () => {
    throw new Error('SecurityError');
  };
  return {
    getItem: boom,
    setItem: boom,
    removeItem: boom,
    clear: boom,
    key: boom,
    length: 0,
  };
}

describe('filterTickets / countByFilter', () => {
  it('filters by status, keeping only matching cards', () => {
    expect(filterTickets(tickets, 'blocked').map((t) => t.id)).toEqual(['B-1', 'B-2']);
    expect(filterTickets(tickets, 'all')).toHaveLength(tickets.length);
  });

  it('Parked is the subset of Ready whose last word was a park; Ready counts it too', () => {
    expect(filterTickets(tickets, 'parked').map((t) => t.id)).toEqual(['P-1']);
    expect(filterTickets(tickets, 'ready').map((t) => t.id)).toEqual(['R-1', 'P-1']);
  });

  it('counts every chip', () => {
    const counts = countByFilter(tickets);
    expect(counts).toMatchObject({
      all: 6,
      ready: 2,
      parked: 1,
      claimed: 0,
      in_progress: 0,
      in_review: 1,
      blocked: 2,
      done: 1,
    });
  });

  it('a filtered board keeps every column in each remaining lane, and drops lanes with no match', () => {
    const lanes = groupIntoLanes(filterTickets(tickets, 'blocked'));
    expect(lanes.map((l) => l.lane)).toEqual(['api', 'ui']);
    expect(lanes[0]!.columns.map((c) => c.status)).toEqual(
      groupIntoLanes(tickets)[0]!.columns.map((c) => c.status),
    );
    expect(lanes[0]!.columns.find((c) => c.status === 'ready')!.tickets).toEqual([]);
  });
});

describe('parse and persistence', () => {
  it('parses only known filters', () => {
    expect(parseBoardFilter('blocked')).toBe('blocked');
    expect(parseBoardFilter('all')).toBe('all');
    expect(parseBoardFilter('waived')).toBeNull();
    expect(parseBoardFilter('<script>')).toBeNull();
    expect(parseBoardFilter(null)).toBeNull();
  });

  it('remembers per project and forgets on "all"', () => {
    const storage = memoryStorage();
    writeStoredBoardFilter('p1', 'blocked', storage);
    expect(readStoredBoardFilter('p1', storage)).toBe('blocked');
    expect(readStoredBoardFilter('p2', storage)).toBeNull();
    writeStoredBoardFilter('p1', 'all', storage);
    expect(storage.getItem(boardFilterStorageKey('p1'))).toBeNull();
  });

  it('a throwing storage never breaks the board', () => {
    const storage = throwingStorage();
    expect(() => writeStoredBoardFilter('p1', 'done', storage)).not.toThrow();
    expect(readStoredBoardFilter('p1', storage)).toBeNull();
    expect(initialBoardFilter('p1', '', storage)).toBe('all');
  });

  it('the URL wins over the remembered choice; a bad URL value falls back to it', () => {
    const storage = memoryStorage();
    writeStoredBoardFilter('p1', 'done', storage);
    expect(initialBoardFilter('p1', '?project=p1&filter=blocked', storage)).toBe(
      'blocked',
    );
    expect(initialBoardFilter('p1', '?project=p1&filter=nope', storage)).toBe('done');
    expect(initialBoardFilter('p1', '?project=p1', undefined)).toBe('all');
  });
});
