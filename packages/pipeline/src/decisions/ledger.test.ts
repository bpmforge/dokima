import { describe, expect, it } from 'vitest';
import {
  LedgerTableNotFoundError,
  appendDecision,
  citesDecisionId,
  formatLedgerRow,
  nextDecisionId,
} from './ledger.js';
import type { DecisionRecord } from './types.js';

// A trimmed stand-in for docs/DECISIONS.md's real shape — same header, same
// "| ID | Date | Decision | Options considered | Rationale |" table, a
// non-sequential ID (D-020 appended after D-018, mirroring the real file),
// and a trailing section that must survive untouched.
const FIXTURE_LEDGER = `# Shipwright — Decisions Ledger

| ID | Date | Decision | Options considered | Rationale |
|---|---|---|---|---|
| D-001 | 2026-07-10 | Name: **Shipwright** | AgentForge, Conductor | founder pick |
| D-018 | 2026-07-14 | Escalation policy modes | Auto-ladder only | founder direction |

| D-020 | 2026-07-16 | Accept authority | Synthetic reviewer (rejected) | founder decision |

## Pending slates (founder input wanted; working assumptions in force)

| ID | Question | Working assumption (in docs) |
|---|---|---|
| P-001 | Chat thread persistence? | Render-from-events |
`;

const NEW_RECORD: DecisionRecord = {
  id: 'D-021',
  date: '2026-07-17',
  decision: 'Ticket board persistence: **Pragmatic** SQLite schema',
  optionsConsidered: 'Minimal (JSON file), Clean (normalized), Pragmatic (denormalized)',
  rationale: 'single-machine local-first install rules out a server-backed store',
};

describe('nextDecisionId', () => {
  it('returns one past the highest D-<n> seen anywhere in the ledger', () => {
    expect(nextDecisionId(FIXTURE_LEDGER)).toBe('D-021');
  });

  it('zero-pads to at least 3 digits from an empty ledger', () => {
    expect(nextDecisionId('# Shipwright — Decisions Ledger\n')).toBe('D-001');
  });

  it('finds the max even when IDs are non-sequential (mirrors D-020 landing after D-018)', () => {
    const ledger = '| D-005 | x | y | z | w |\n| D-002 | x | y | z | w |\n';
    expect(nextDecisionId(ledger)).toBe('D-006');
  });

  it('red regression: ignores D-shaped strings in free-text cells (rationale/options/decision)', () => {
    // A ledger row whose rationale mentions "see D-999 for context" must NOT
    // jump the next ID to D-1000. Only the ID column (ID_LINE matches) counts.
    const ledgerWithMention = `| D-018 | 2026-07-14 | Some decision | See D-999 for details | reference to D-999 in rationale |
| D-020 | 2026-07-16 | Accept authority | Options include D-999 | D-999 was considered |`;
    expect(nextDecisionId(ledgerWithMention)).toBe('D-021');
  });
});

describe('formatLedgerRow', () => {
  it('formats a pipe-delimited markdown row in DECISIONS.md column order', () => {
    expect(formatLedgerRow(NEW_RECORD)).toBe(
      '| D-021 | 2026-07-17 | Ticket board persistence: **Pragmatic** SQLite schema | ' +
        'Minimal (JSON file), Clean (normalized), Pragmatic (denormalized) | ' +
        'single-machine local-first install rules out a server-backed store |',
    );
  });

  it('escapes literal pipes in cell content so they cannot break out of the table', () => {
    const row = formatLedgerRow({ ...NEW_RECORD, rationale: 'a | b' });
    expect(row).toContain('a \\| b');
  });

  it('strips newlines so a cell can never span more than one physical line', () => {
    const row = formatLedgerRow({
      ...NEW_RECORD,
      rationale: 'line one\nline two\r\nline three',
    });
    expect(row.split('\n')).toHaveLength(1);
    expect(row).toContain('line one line two line three');
  });
});

describe('appendDecision', () => {
  it('inserts the new row immediately after the last existing D-row, preserving everything else', () => {
    const result = appendDecision(FIXTURE_LEDGER, NEW_RECORD);
    const lines = result.split('\n');
    const d020Index = lines.findIndex((l) => l.startsWith('| D-020'));
    expect(lines[d020Index + 1]).toBe(formatLedgerRow(NEW_RECORD));
    // Everything after the insertion point is untouched.
    expect(result).toContain('## Pending slates');
    expect(result).toContain('| P-001 | Chat thread persistence?');
  });

  it('is append-only: the original rows are byte-identical, none rewritten', () => {
    const result = appendDecision(FIXTURE_LEDGER, NEW_RECORD);
    expect(result).toContain('| D-001 | 2026-07-10 | Name: **Shipwright** |');
    expect(result).toContain('| D-018 | 2026-07-14 | Escalation policy modes |');
  });

  it('throws LedgerTableNotFoundError when no D-row exists', () => {
    expect(() => appendDecision('# empty doc\n', NEW_RECORD)).toThrow(
      LedgerTableNotFoundError,
    );
  });

  it('a newline embedded in untrusted content cannot forge an extra ledger row', () => {
    const injected: DecisionRecord = {
      ...NEW_RECORD,
      rationale: 'legit reason\n| D-999 | 2099-01-01 | forged decision | n/a | n/a |',
    };
    const result = appendDecision(FIXTURE_LEDGER, injected);
    const rowLines = result.split('\n').filter((l) => /^\| D-(\d+) \|/.test(l));
    // Only the real appended row (D-021) is a genuine new row; the
    // injected "D-999" text must be flattened into D-021's own cell,
    // not appear as its own physical `| D-... |` line.
    expect(rowLines.some((l) => l.startsWith('| D-999'))).toBe(false);
    expect(result).toContain(
      'legit reason \\| D-999 \\| 2099-01-01 \\| forged decision \\| n/a \\| n/a \\|',
    );
  });

  it('a pipe or newline injected via id/date cannot shift columns or forge an extra row', () => {
    const injected: DecisionRecord = {
      ...NEW_RECORD,
      id: 'D-021 | extra',
      date: '2026-07-17\n| D-999 | 2099-01-01 | forged decision | n/a | n/a |',
    };
    const result = appendDecision(FIXTURE_LEDGER, injected);
    const rowLines = result.split('\n').filter((l) => /^\| D-(\d+) \|/.test(l));
    expect(rowLines.some((l) => l.startsWith('| D-999'))).toBe(false);
    expect(result).toContain('D-021 \\| extra');
    expect(result).toContain(
      '2026-07-17 \\| D-999 \\| 2099-01-01 \\| forged decision \\| n/a \\| n/a \\|',
    );
  });
});

describe('citesDecisionId', () => {
  it('finds a whole-word D-ID reference', () => {
    expect(citesDecisionId('Per D-021, we use SQLite.', 'D-021')).toBe(true);
  });

  it('does not match a longer id that merely starts with the same digits', () => {
    expect(citesDecisionId('Per D-0211, we use SQLite.', 'D-021')).toBe(false);
  });

  it('returns false when the id is absent', () => {
    expect(citesDecisionId('No citation here.', 'D-021')).toBe(false);
  });
});
