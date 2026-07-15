/**
 * Minimal RFC 6455 frame codec — only the subset the projection-hub
 * protocol needs: unfragmented text/close/ping/pong frames, no compression
 * (the handshake never negotiates an extension, so a compliant peer never
 * sends RSV bits). Kept dependency-free on purpose: `apps/server/package.json`
 * is outside this ticket's write_scope, so `ws`/`@fastify/websocket` aren't
 * reachable — see `ws-socket.ts` for the socket wrapper this backs.
 */

export const OPCODE = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
} as const;

export type Opcode = (typeof OPCODE)[keyof typeof OPCODE];

export interface DecodedFrame {
  opcode: Opcode;
  payload: Buffer;
}

/** A frame that violates the subset this codec supports (client sent an
 * unmasked frame, a fragmented message, or reserved bits with no negotiated
 * extension) — callers should terminate the connection, not recover. */
export class WsProtocolError extends Error {}

const MAX_PAYLOAD_BYTES = 1024 * 1024;

/** Server→client frames are never masked (RFC 6455 §5.1). */
export function encodeFrame(opcode: Opcode, payload: Buffer): Buffer {
  const finAndOpcode = 0x80 | opcode;
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([finAndOpcode, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = finAndOpcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = finAndOpcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

/**
 * Streaming decoder: feed raw TCP bytes via `push`, get back zero or more
 * complete, unmasked frames. TCP gives no framing guarantee (one `data`
 * event may hold a partial frame or several), so this buffers until a full
 * frame is available.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): DecodedFrame[] {
    this.buffer = this.buffer.length > 0 ? Buffer.concat([this.buffer, chunk]) : chunk;
    const frames: DecodedFrame[] = [];
    for (;;) {
      const frame = this.tryParseOne();
      if (!frame) break;
      frames.push(frame);
    }
    return frames;
  }

  private tryParseOne(): DecodedFrame | undefined {
    const buf = this.buffer;
    if (buf.length < 2) return undefined;

    const byte0 = buf[0]!;
    const byte1 = buf[1]!;
    const fin = (byte0 & 0x80) !== 0;
    const rsv = byte0 & 0x70;
    const opcode = (byte0 & 0x0f) as Opcode;
    const masked = (byte1 & 0x80) !== 0;
    let len = byte1 & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < offset + 2) return undefined;
      len = buf.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buf.length < offset + 8) return undefined;
      len = Number(buf.readBigUInt64BE(offset));
      offset += 8;
    }
    if (len > MAX_PAYLOAD_BYTES) throw new WsProtocolError('frame payload too large');
    if (rsv !== 0)
      throw new WsProtocolError('unsupported RSV bits (no extension negotiated)');
    if (!masked) throw new WsProtocolError('client frame must be masked (RFC 6455 §5.1)');

    if (buf.length < offset + 4) return undefined;
    const maskKey = buf.subarray(offset, offset + 4);
    offset += 4;

    if (buf.length < offset + len) return undefined;
    const maskedPayload = buf.subarray(offset, offset + len);
    const payload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) payload[i] = maskedPayload[i]! ^ maskKey[i % 4]!;

    this.buffer = buf.subarray(offset + len);
    if (!fin) throw new WsProtocolError('fragmented frames are not supported');

    return { opcode, payload };
  }
}
