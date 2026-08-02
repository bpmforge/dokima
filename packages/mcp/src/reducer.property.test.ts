import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rebuildProjection, type EventRecord } from '@dokima/events';
import { MCP_APPROVAL_DOMAIN, mcpProjection } from './reducer.js';

const TOOL_IDS = ['fs-server:read', 'fs-server:write', 'fs-server:shell'] as const;
const ROLES = ['coding-agent', 'code-reviewer'] as const;
const APPROVAL_IDS = ['call-a', 'call-b', 'call-c'] as const;

/** One arbitrary that produces a plausible event of one of the 5 MCP event types — including nonsensical orderings (e.g. a decide before a request), since the reducer must be a pure, order-tolerant fold, not just correct on well-formed sequences. */
const mcpEventArb: fc.Arbitrary<EventRecord> = fc
  .oneof(
    fc.record({
      eventType: fc.constant('mcp.server_registered' as const),
      payload: fc.record({
        id: fc.constant('fs-server'),
        name: fc.constant('Filesystem server'),
        transport: fc.constant('stdio' as const),
        command: fc.constant(null),
        args: fc.constant([]),
        url: fc.constant(null),
        description: fc.constant(null),
        tools: fc.constant(
          TOOL_IDS.map((id) => ({
            id,
            name: id,
            description: null,
            requiresApproval: id.endsWith('shell')
              ? ('dynamic' as const)
              : id.endsWith('write'),
          })),
        ),
      }),
    }),
    fc.record({
      eventType: fc.constant('mcp.allowlist_set' as const),
      payload: fc.record({
        role: fc.constantFrom(...ROLES),
        toolIds: fc.subarray([...TOOL_IDS]),
      }),
    }),
    fc.record({
      eventType: fc.constant('approval.requested' as const),
      payload: fc.record({
        approvalId: fc.constantFrom(...APPROVAL_IDS),
        domain: fc.constantFrom(MCP_APPROVAL_DOMAIN, 'some_other_domain'),
        toolId: fc.constantFrom(...TOOL_IDS),
        serverId: fc.constant('fs-server'),
        role: fc.constantFrom(...ROLES),
        requestedBy: fc.constantFrom('coding-agent', 'human-1'),
        args: fc.constant({}),
        argsDigest: fc.constant('deadbeef'),
        estimatedCost: fc.constant(null),
      }),
    }),
    fc.record({
      eventType: fc.constant('approval.decided' as const),
      payload: fc.record({
        approvalId: fc.constantFrom(...APPROVAL_IDS),
        domain: fc.constantFrom(MCP_APPROVAL_DOMAIN, 'some_other_domain'),
        decision: fc.constantFrom('approved' as const, 'denied' as const),
        decidedBy: fc.constantFrom('human-1', 'human-2'),
      }),
    }),
    fc.record({
      eventType: fc.constant('mcp.tool_call.completed' as const),
      payload: fc.record({
        id: fc.constantFrom(...APPROVAL_IDS),
        toolId: fc.constantFrom(...TOOL_IDS),
        serverId: fc.constant('fs-server'),
        role: fc.constantFrom(...ROLES),
        actorId: fc.constant('coding-agent'),
        argsDigest: fc.constant('deadbeef'),
        resultDigest: fc.constant('cafebabe'),
        cost: fc.float({ min: 0, max: 10, noNaN: true }),
        requiresApproval: fc.boolean(),
      }),
    }),
    fc.record({
      eventType: fc.constant('mcp.tool_call.denied' as const),
      payload: fc.record({
        id: fc.constantFrom(...APPROVAL_IDS),
        toolId: fc.constantFrom(...TOOL_IDS),
        serverId: fc.constant('fs-server'),
        role: fc.constantFrom(...ROLES),
        actorId: fc.constant('coding-agent'),
        argsDigest: fc.constant('deadbeef'),
      }),
    }),
  )
  .map(({ eventType, payload }): Omit<EventRecord, 'seq' | 'prevHash' | 'hash'> => ({
    eventType,
    actorId: 'human-1',
    ticketId: null,
    runId: null,
    payload,
    createdAt: '2026-07-18T00:00:00.000Z',
  })) as fc.Arbitrary<EventRecord>;

const eventsArb = fc.array(mcpEventArb, { maxLength: 40 }).map((events) =>
  events.map((event, index): EventRecord => ({
    ...event,
    seq: index + 1,
    prevHash: '0'.repeat(64),
    hash: String(index + 1),
  })),
);

function applyIncremental(events: readonly EventRecord[]) {
  return events.reduce(
    (state, event) => mcpProjection.reduce(state, event),
    mcpProjection.initial(),
  );
}

describe('mcpProjection: rebuild-from-zero equals incremental apply (PLAYBOOK.md testable-first)', () => {
  it('holds for any sequence of MCP + foreign-domain approval events', () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        const incremental = applyIncremental(events);
        const rebuilt = rebuildProjection(events, mcpProjection);
        expect(Array.from(incremental.servers.entries())).toEqual(
          Array.from(rebuilt.servers.entries()),
        );
        expect(Array.from(incremental.tools.entries())).toEqual(
          Array.from(rebuilt.tools.entries()),
        );
        expect(
          Array.from(incremental.allowlist.entries()).map(([role, ids]) => [
            role,
            Array.from(ids).sort(),
          ]),
        ).toEqual(
          Array.from(rebuilt.allowlist.entries()).map(([role, ids]) => [
            role,
            Array.from(ids).sort(),
          ]),
        );
        expect(Array.from(incremental.pendingApprovals.entries())).toEqual(
          Array.from(rebuilt.pendingApprovals.entries()),
        );
        expect(incremental.callLog).toEqual(rebuilt.callLog);
      }),
    );
  });

  it('rebuilding a prefix then applying the remainder matches rebuilding the whole log', () => {
    fc.assert(
      fc.property(eventsArb, fc.nat(), (events, splitSeed) => {
        const splitAt = events.length === 0 ? 0 : splitSeed % events.length;
        const prefix = events.slice(0, splitAt);
        const rest = events.slice(splitAt);

        const prefixState = rebuildProjection(prefix, mcpProjection);
        const continued = rest.reduce(
          (state, event) => mcpProjection.reduce(state, event),
          prefixState,
        );
        const wholeRebuild = rebuildProjection(events, mcpProjection);

        expect(continued.callLog).toEqual(wholeRebuild.callLog);
        expect(Array.from(continued.pendingApprovals.entries())).toEqual(
          Array.from(wholeRebuild.pendingApprovals.entries()),
        );
      }),
    );
  });

  it('ignores approval.requested/decided events carrying a foreign domain', () => {
    const foreignRequested: EventRecord = {
      seq: 1,
      eventType: 'approval.requested',
      actorId: 'human-1',
      ticketId: null,
      runId: null,
      payload: {
        approvalId: 'x',
        domain: 'some_other_domain',
        toolId: 'fs-server:write',
        serverId: 'fs-server',
        role: 'coding-agent',
        requestedBy: 'coding-agent',
        args: {},
        argsDigest: 'deadbeef',
        estimatedCost: null,
      },
      createdAt: '2026-07-18T00:00:00.000Z',
      prevHash: '0'.repeat(64),
      hash: '1',
    };
    const state = rebuildProjection([foreignRequested], mcpProjection);
    expect(state.pendingApprovals.size).toBe(0);
  });
});
