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
import { verbForDrop, verbTargetColumn } from './transitions.js';
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
      const result = await fireTicketVerb(
        apiOpts.current,
        ticketId,
        verb,
        opts.projectId,
      );
      if (result.ok) {
        setTickets((current) => confirmOptimisticMove(current, ticketId, result.data));
        setRefusal(null);
      } else {
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
      if (!verb) return; // illegal drop — snaps back, never reaches the network (UX_SPEC §4)
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
  };
}
