/**
 * Projection-stream client (API_DESIGN §3). Subscribes, tracks the highest
 * `seq` seen per subscription, and sends `resume` on reconnect so a dropped
 * connection never loses a delta — correctness never depends on the socket
 * staying open (every subscription also has a REST read, per API_DESIGN).
 */

export interface ServerEnvelope {
  sub: string;
  seq: number;
  type: string;
  at: string;
  data: unknown;
}

export function parseServerEnvelope(raw: string): ServerEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.sub === 'string' &&
    typeof candidate.seq === 'number' &&
    typeof candidate.type === 'string' &&
    typeof candidate.at === 'string' &&
    'data' in candidate
  ) {
    return candidate as unknown as ServerEnvelope;
  }
  return null;
}

export interface WsClientOptions {
  url: string;
  token: string;
  subscriptions: string[];
  onEnvelope: (envelope: ServerEnvelope) => void;
  WebSocketImpl?: typeof WebSocket;
}

export class WsClient {
  private socket: WebSocket | undefined;
  private readonly lastSeq = new Map<string, number>();

  constructor(private readonly opts: WsClientOptions) {}

  connect(): void {
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    const url = new URL(this.opts.url);
    url.searchParams.set('token', this.opts.token);
    const socket = new Impl(url.toString());

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({ op: 'subscribe', subscriptions: this.opts.subscriptions }),
      );
      const maxSeq = Math.max(0, ...Array.from(this.lastSeq.values()));
      if (maxSeq > 0) socket.send(JSON.stringify({ op: 'resume', last_seq: maxSeq }));
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      const envelope = parseServerEnvelope(String(event.data));
      if (!envelope) return;
      this.lastSeq.set(envelope.sub, envelope.seq);
      this.opts.onEnvelope(envelope);
    });

    this.socket = socket;
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
  }
}
