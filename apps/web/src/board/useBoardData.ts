import { useCallback, useEffect, useRef, useState } from 'react';
import { WsClient, type ServerEnvelope } from '../lib/ws-client.js';
import {
  fetchBoardTickets,
  fireTicketVerb,
  type BoardApiOptions,
  type LifecycleVerb,
} from './api.js';
import {
  beginOptimisticMove,
  confirmOptimisticMove,
  rollbackOptimisticMove,
  type BoardTicketMap,
} from './dragOptimistic.js';
import {
  applyBoardEnvelope,
  applyHeartbeatEnvelope,
  boardSubscription,
  runSubscription,
} from './projection.js';
import { COLUMN_LABEL, verbForDrop, verbTargetColumn } from './transitions.js';
import type {
  BoardTicket,
  HeartbeatData,
  ProblemDetails,
  TicketStatus,
} from './types.js';

export interface UseBoardDataOptions {
  baseUrl: string;
  token: string;
  projectId: string;
  runId?: string;
  wsUrl: string;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
}

export interface BoardRefusal {
  ticketId: string;
  problem: ProblemDetails;
}

export interface UseBoardDataResult {
  tickets: BoardTicket[];
  heartbeats: ReadonlyMap<string, HeartbeatData>;
  loading: boolean;
  refusal: BoardRefusal | null;
  dismissRefusal: () => void;
  fireVerb: (ticketId: string, verb: LifecycleVerb) => Promise<void>;
  handleDrop: (ticketId: string, toColumn: TicketStatus) => void;
  /** Polite live-region text: where a ticket moved, or why it didn't. */
  announcement: string;
}

/**
 * Fetches the initial board projection (`GET /projects/{id}/tickets`),
 * then keeps it live via the `board:{projectId}` WS subscription
 * (API_DESIGN §3, ≤1s freshness — FR-C4). A drag/verb-menu action applies
 * optimistically and rolls back on a 409 invariant refusal (FR-T4).
 */
export function useBoardData(opts: UseBoardDataOptions): UseBoardDataResult {
  const [tickets, setTickets] = useState<BoardTicketMap>(new Map());
  const [heartbeats, setHeartbeats] = useState<ReadonlyMap<string, HeartbeatData>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [refusal, setRefusal] = useState<BoardRefusal | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const apiOpts = useRef<BoardApiOptions>({
    baseUrl: opts.baseUrl,
    token: opts.token,
    fetchImpl: opts.fetchImpl,
  });
  apiOpts.current = {
    baseUrl: opts.baseUrl,
    token: opts.token,
    fetchImpl: opts.fetchImpl,
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchBoardTickets(apiOpts.current, opts.projectId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setTickets(new Map(result.data.map((t) => [t.id, t])));
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [opts.projectId]);

  useEffect(() => {
    const subscriptions = [boardSubscription(opts.projectId)];
    if (opts.runId) subscriptions.push(runSubscription(opts.runId));
    const client = new WsClient({
      url: opts.wsUrl,
      token: opts.token,
      subscriptions,
      WebSocketImpl: opts.WebSocketImpl,
      onEnvelope: (envelope: ServerEnvelope) => {
        setTickets((current) => applyBoardEnvelope(current, envelope));
        setHeartbeats((current) => applyHeartbeatEnvelope(current, envelope));
      },
    });
    client.connect();
    return () => client.close();
  }, [opts.projectId, opts.runId, opts.wsUrl, opts.token, opts.WebSocketImpl]);

  const fireVerb = useCallback(
    async (ticketId: string, verb: LifecycleVerb) => {
      const toStatus = verb === 'comment' ? undefined : verbTargetColumn(verb);
      const move = toStatus ? beginOptimisticMove(tickets, ticketId, toStatus) : null;
      if (move) setTickets(move.tickets);
      // A fetch that REJECTS (core down, network gone) must still roll the
      // optimistic move back and explain itself, same as BoardView's runs.
      const result = await fireTicketVerb(
        apiOpts.current,
        ticketId,
        verb,
        opts.projectId,
      ).catch((err: unknown) => ({
        ok: false as const,
        problem: {
          type: 'about:blank',
          title: 'the core could not be reached',
          status: 0,
          detail: err instanceof Error ? err.message : String(err),
          instance: `/tickets/${ticketId}/${verb}`,
          request_id: 'unknown',
        },
      }));
      if (result.ok) {
        setTickets((current) => confirmOptimisticMove(current, ticketId, result.data));
        setRefusal(null);
        if (toStatus) setAnnouncement(`${ticketId} moved to ${COLUMN_LABEL[toStatus]}`);
      } else {
        setAnnouncement(`${ticketId} was not moved: ${result.problem.title}`);
        if (move)
          setTickets((current) =>
            rollbackOptimisticMove(current, ticketId, move.snapshot),
          );
        setRefusal({ ticketId, problem: result.problem });
      }
    },
    [tickets, opts.projectId],
  );

  const handleDrop = useCallback(
    (ticketId: string, toColumn: TicketStatus) => {
      const ticket = tickets.get(ticketId);
      if (!ticket) return;
      const verb = verbForDrop(ticket.status, toColumn);
      if (!verb) {
        // Illegal drop: snaps back, never reaches the network (UX_SPEC §4),
        // but says why instead of failing silently.
        if (ticket.status !== toColumn)
          setAnnouncement(
            `${ticketId} can't move from ${COLUMN_LABEL[ticket.status]} to ${COLUMN_LABEL[toColumn]} directly`,
          );
        return;
      }
      void fireVerb(ticketId, verb);
    },
    [tickets, fireVerb],
  );

  return {
    tickets: Array.from(tickets.values()),
    heartbeats,
    loading,
    refusal,
    dismissRefusal: () => setRefusal(null),
    fireVerb,
    handleDrop,
    announcement,
  };
}
