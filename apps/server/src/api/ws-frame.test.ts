import { describe, expect, it } from 'vitest';
import { encodeFrame, FrameDecoder, OPCODE, WsProtocolError } from './ws-frame.js';

/** Masks a payload the way a real client must (RFC 6455 §5.3). */
function maskedClientFrame(
  opcode: number,
  payload: Buffer,
  maskKey = Buffer.from([1, 2, 3, 4]),
): Buffer {
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i]! ^ maskKey[i % 4]!;

  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, maskKey, masked]);
}

describe('encodeFrame', () => {
  it('encodes a short unmasked text frame with FIN set', () => {
    const payload = Buffer.from('hi');
    const frame = encodeFrame(OPCODE.TEXT, payload);
    expect(frame[0]).toBe(0x80 | OPCODE.TEXT);
    expect(frame[1]! & 0x80).toBe(0); // server frames are never masked
    expect(frame[1]! & 0x7f).toBe(2);
    expect(frame.subarray(2)).toEqual(payload);
  });

  it('uses the 16-bit extended length for payloads >= 126 bytes', () => {
    const payload = Buffer.alloc(200, 'a');
    const frame = encodeFrame(OPCODE.TEXT, payload);
    expect(frame[1]).toBe(126);
    expect(frame.readUInt16BE(2)).toBe(200);
    expect(frame.subarray(4)).toEqual(payload);
  });

  it('uses the 64-bit extended length for payloads >= 65536 bytes', () => {
    const payload = Buffer.alloc(70_000, 'b');
    const frame = encodeFrame(OPCODE.TEXT, payload);
    expect(frame[1]).toBe(127);
    expect(Number(frame.readBigUInt64BE(2))).toBe(70_000);
    expect(frame.subarray(10)).toEqual(payload);
  });
});

describe('FrameDecoder', () => {
  it('decodes a small masked client frame delivered in one chunk', () => {
    const decoder = new FrameDecoder();
    const payload = Buffer.from(JSON.stringify({ op: 'subscribe' }));
    const frames = decoder.push(maskedClientFrame(OPCODE.TEXT, payload));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.opcode).toBe(OPCODE.TEXT);
    expect(frames[0]!.payload).toEqual(payload);
  });

  it('decodes a frame delivered across several TCP chunks', () => {
    const decoder = new FrameDecoder();
    const payload = Buffer.from('hello world');
    const raw = maskedClientFrame(OPCODE.TEXT, payload);

    expect(decoder.push(raw.subarray(0, 3))).toEqual([]);
    expect(decoder.push(raw.subarray(3, 8))).toEqual([]);
    const frames = decoder.push(raw.subarray(8));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.payload).toEqual(payload);
  });

  it('decodes two frames delivered in a single chunk', () => {
    const decoder = new FrameDecoder();
    const a = maskedClientFrame(OPCODE.TEXT, Buffer.from('a'));
    const b = maskedClientFrame(OPCODE.PING, Buffer.alloc(0));
    const frames = decoder.push(Buffer.concat([a, b]));
    expect(frames).toHaveLength(2);
    expect(frames[0]!.opcode).toBe(OPCODE.TEXT);
    expect(frames[1]!.opcode).toBe(OPCODE.PING);
  });

  it('decodes a 16-bit extended-length masked frame', () => {
    const decoder = new FrameDecoder();
    const payload = Buffer.alloc(500, 'x');
    const frames = decoder.push(maskedClientFrame(OPCODE.TEXT, payload));
    expect(frames[0]!.payload).toEqual(payload);
  });

  it('rejects an unmasked client frame (RFC 6455 §5.1)', () => {
    const decoder = new FrameDecoder();
    const unmasked = encodeFrame(OPCODE.TEXT, Buffer.from('x'));
    expect(() => decoder.push(unmasked)).toThrow(WsProtocolError);
  });

  it('rejects a fragmented (non-FIN) frame', () => {
    const decoder = new FrameDecoder();
    const payload = Buffer.from('partial');
    const maskKey = Buffer.from([9, 8, 7, 6]);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i]! ^ maskKey[i % 4]!;
    // FIN bit (0x80) intentionally left unset.
    const header = Buffer.from([OPCODE.TEXT, 0x80 | payload.length]);
    expect(() => decoder.push(Buffer.concat([header, maskKey, masked]))).toThrow(
      WsProtocolError,
    );
  });

  it('rejects a frame with reserved bits set (no extension negotiated)', () => {
    const decoder = new FrameDecoder();
    const header = Buffer.from([0x80 | 0x40 | OPCODE.TEXT, 0x80 | 0]);
    const maskKey = Buffer.from([0, 0, 0, 0]);
    expect(() => decoder.push(Buffer.concat([header, maskKey]))).toThrow(WsProtocolError);
  });

  it('rejects a frame declaring a payload larger than the safety cap', () => {
    const decoder = new FrameDecoder();
    const header = Buffer.alloc(10);
    header[0] = 0x80 | OPCODE.TEXT;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(10 * 1024 * 1024), 2);
    const maskKey = Buffer.from([0, 0, 0, 0]);
    expect(() => decoder.push(Buffer.concat([header, maskKey]))).toThrow(WsProtocolError);
  });
});
