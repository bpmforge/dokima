/**
 * Injectable packet redaction (SC-06, W3-13). `packages/memory` can't
 * declare `@shipwright/shared` as a `package.json` dependency from this
 * ticket's write_scope (`packages/memory/src/packer/**` only), so the
 * packer accepts a duck-typed `PacketRedactor` instead of importing
 * `redactString`/`redactDeep` directly — same injectable shape as
 * `code-index/events.ts`'s event sink.
 *
 * Runtime safety net regardless of this hook: `packages/loop/src/handoff.ts`'s
 * `renderHandoff` already runs `@shipwright/shared`'s `redactDeep` over every
 * HANDOFF's `context` field before it reaches a session, a log, or a human's
 * screen — that is SC-06's actual choke point today. The hook here is what
 * lets `assemblePacket` itself satisfy this ticket's notes ("context-packet
 * assembly must call the W3-13 redaction layer on every packet") for any
 * future consumer that reads an assembled packet without going through
 * `renderHandoff`. A real caller wires `{ redact: (t) => redactString(t,
 * secretValues) }` in; the noop default below is only for callers with no
 * secret material to protect (tests, exploratory scripts).
 */

export interface PacketRedactor {
  redact(text: string): string;
}

export const noopPacketRedactor: PacketRedactor = {
  redact: (text) => text,
};
