import { describe, expect, it } from 'vitest';
import type { Ticket } from '@shipwright/tickets';
import { DEFAULT_VERIFY_COMMAND, defaultHandoffBuilder } from './loop-handoff.js';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'W9-01',
    type: 'task',
    title: 'Sample ticket',
    lane: 'core',
    ownerId: null,
    status: 'ready',
    interface: null,
    writeScope: ['packages/example/**'],
    dependsOn: [],
    acceptance: [{ id: 'A1', text: 'does the thing', done: false }],
    verify: null,
    manifest: null,
    history: [],
    evidence: [],
    claimedAt: null,
    closedAt: null,
    ...overrides,
  };
}

describe('defaultHandoffBuilder', () => {
  it('projects the ticket fields the HANDOFF contract needs', () => {
    const build = defaultHandoffBuilder();
    const handoff = build(
      ticket({
        verify: 'pnpm --filter example test',
        writeScope: ['packages/example/**'],
      }),
    );

    expect(handoff.role).toBe('coding-agent');
    expect(handoff.mission).toBe('Sample ticket');
    expect(handoff.ticket).toEqual({ id: 'W9-01', title: 'Sample ticket' });
    expect(handoff.writeScope).toEqual(['packages/example/**']);
    expect(handoff.produce).toEqual(['does the thing']);
    expect(handoff.verify).toBe('pnpm --filter example test');
  });

  it('falls back to the project full gate when the ticket has no verify command', () => {
    const build = defaultHandoffBuilder();
    const handoff = build(ticket({ verify: null }));
    expect(handoff.verify).toBe(DEFAULT_VERIFY_COMMAND);
  });

  it('uses the interface field for context when present, else the title', () => {
    const build = defaultHandoffBuilder();
    expect(build(ticket({ interface: 'GET /widgets' })).context).toBe('GET /widgets');
    expect(build(ticket({ interface: null })).context).toBe('Sample ticket');
  });

  it('honors an explicit role override', () => {
    const build = defaultHandoffBuilder('code-reviewer');
    expect(build(ticket()).role).toBe('code-reviewer');
  });
});
