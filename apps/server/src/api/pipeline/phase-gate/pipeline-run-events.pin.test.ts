/**
 * W9-06 criterion 5 pin: `PipelineRunEvent` output (model-authored interview/blueprint/
 * decompose phases) must NEVER get a gate receipt — that's the SECURITY_W5 CRITICAL FIX
 * `../pipeline-routes/events.ts`'s header documents ("no independent validator runs on
 * it, so minting a passing gate receipt for it would be self-attestation"). This is a
 * REGRESSION PIN, not a red fixture in the planted-defect sense: it passes today by
 * construction (this ticket adds no code path that touches `emitPhaseEvent` or
 * `pipeline-routes/**`, which stay outside this ticket's write_scope). Its job is to
 * fail loudly if a future change ever re-adds a receipt mint there — asserting BOTH the
 * stronger check (zero rows in the `receipts` table) and the weaker one (no
 * `gate.receipt_minted`/`gate.waived` event in the log).
 */
import { describe, expect, it } from 'vitest';
import { listEvents, openEventLog, type EventLog } from '@dokima/events';
import type { PipelineRunEvent } from '@dokima/pipeline';
import { emitPhaseEvent } from '../pipeline-routes/events.js';
import { ensureOperatorIdentity } from '../../server/board-actor.js';

const SAMPLE_EVENTS: readonly PipelineRunEvent[] = [
  { kind: 'interview-complete', topicCount: 4 },
  // W22-26: the event now carries the document, which makes this pin MORE
  // load-bearing rather than less — model-authored content of any size must
  // still never earn a receipt.
  { kind: 'blueprint-synthesized', version: 1, markdown: '# Sample\n\nA product.' },
  { kind: 'decisions-decided', slateTitle: 'Technical Slate v1' },
  { kind: 'decomposed', ticketCount: 12 },
];

describe('pipeline-run events stay unanchored (W9-06 criterion 5 pin)', () => {
  it('emitPhaseEvent never mints a receipt for model-authored phase output', () => {
    const log: EventLog = openEventLog(':memory:');
    try {
      ensureOperatorIdentity(log);
      const now = () => '2026-07-27T00:00:00.000Z';

      for (const event of SAMPLE_EVENTS) {
        emitPhaseEvent(log, { runId: 'run-w9-06-pin', now }, event);
      }

      // Stronger check: the durable receipts table (what `mintReceipt` inserts into)
      // has zero rows — not merely "no receipt we happened to look up".
      const receiptCount = log.db.prepare('SELECT COUNT(*) as n FROM receipts').get() as {
        n: number;
      };
      expect(receiptCount.n).toBe(0);

      // Weaker, corroborating check: the event log itself has no anchoring event of
      // either receipt-minting type, only plain `pipeline.*` audit events.
      const events = listEvents(log);
      expect(events).toHaveLength(SAMPLE_EVENTS.length);
      expect(events.every((e) => e.eventType.startsWith('pipeline.'))).toBe(true);
      expect(
        events.some(
          (e) => e.eventType === 'gate.receipt_minted' || e.eventType === 'gate.waived',
        ),
      ).toBe(false);
    } finally {
      log.close();
    }
  });
});
