/**
 * W21-19. The fixture that matters reproduces the live shape exactly: six
 * identical calls spread across sessions, which the per-session guard cannot
 * see and therefore never stopped.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, openEventLog, type EventLog } from '@dokima/events';
import {
  repeatedZeroInformationCalls,
  repetitionEvidenceLine,
  repetitionHandoffNote,
} from './loop-land-repetition.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function logFixture(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'repetition-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'machine' });
  return log;
}

function toolCall(
  log: EventLog,
  toolId: string,
  argsDigest: string,
  resultDigest: string,
  ticketId = 'T-1',
): void {
  appendEvent(log, {
    eventType: 'mcp.tool_call.completed',
    actorId: 'operator',
    ticketId,
    payload: { toolId, argsDigest, resultDigest },
  });
}

describe('repeatedZeroInformationCalls (W21-19)', () => {
  it('RED FIXTURE: the live shape — six identical list calls across sessions — is counted, where the per-session guard saw nothing', () => {
    const log = logFixture();
    for (let i = 0; i < 6; i += 1) {
      toolCall(log, 'agent-session.list', '4ae486c3', '5a1fa51e');
      // Something else between them every time: this is what reset the
      // per-session counter and hid the pattern.
      toolCall(log, 'agent-session.verify', `v${i}`, `r${i}`);
    }
    const repeats = repeatedZeroInformationCalls({ log, ticketId: 'T-1' });
    expect(repeats).toHaveLength(1);
    expect(repeats[0]).toMatchObject({ toolId: 'agent-session.list', count: 6 });
    log.close();
  });

  it('a repeated call whose RESULT CHANGED learned something and never counts', () => {
    const log = logFixture();
    for (let i = 0; i < 6; i += 1) {
      toolCall(log, 'agent-session.list', 'sameargs', `result-${i}`);
    }
    expect(repeatedZeroInformationCalls({ log, ticketId: 'T-1' })).toHaveLength(0);
    log.close();
  });

  it('mutations are excluded — a repeated write is a retry, not a spin', () => {
    const log = logFixture();
    for (let i = 0; i < 6; i += 1) {
      toolCall(log, 'agent-session.write', 'a', 'b');
      toolCall(log, 'agent-session.commit', 'c', 'd');
    }
    expect(repeatedZeroInformationCalls({ log, ticketId: 'T-1' })).toHaveLength(0);
    log.close();
  });

  it('another ticket’s calls are not this ticket’s problem', () => {
    const log = logFixture();
    for (let i = 0; i < 6; i += 1) toolCall(log, 'agent-session.list', 'a', 'b', 'T-2');
    expect(repeatedZeroInformationCalls({ log, ticketId: 'T-1' })).toHaveLength(0);
    log.close();
  });

  it('below the threshold is silence — two reads are not a pattern', () => {
    const log = logFixture();
    toolCall(log, 'agent-session.list', 'a', 'b');
    toolCall(log, 'agent-session.list', 'a', 'b');
    expect(repeatedZeroInformationCalls({ log, ticketId: 'T-1' })).toHaveLength(0);
    log.close();
  });
});

describe('repetitionEvidenceLine (W21-19)', () => {
  it('says what happened AND that it did not act — otherwise the reader assumes the product handled it', () => {
    const line = repetitionEvidenceLine([
      { toolId: 'agent-session.list', count: 6 },
      { toolId: 'agent-session.read', count: 3 },
    ]);
    expect(line).toContain('agent-session.list');
    expect(line).toContain('6 times');
    expect(line).toContain('1 other repeated call');
    expect(line).toContain('did not stop the run');
  });

  it('nothing to report is null, not an empty sentence', () => {
    expect(repetitionEvidenceLine([])).toBeNull();
  });
});

describe('the session is told what earlier sessions already asked (W21-69)', () => {
  const repeat = (toolId: string, count: number) => ({ toolId, argsJson: '{}', count });

  it('RED FIXTURE: run 52’s pattern reaches the maker as a fact', () => {
    // Verbatim from the ledger (PLAN-vault-002a, seq 4202): the same read was
    // made 61 times across sessions with identical arguments and an identical
    // result. No single session repeated it enough to stop itself, and the
    // next one began with no idea any of it had happened.
    const note = repetitionHandoffNote([
      repeat('agent-session.read', 61),
      repeat('agent-session.list', 7),
    ]);
    expect(note).toContain('61 times');
    expect(note).toContain('agent-session.read');
    expect(note).toContain('1 other call(s)');
  });

  it('states the fact and gives no instruction (acceptance 2)', () => {
    // "Do not read X again" would be the product telling a model how to work,
    // and a wrong instruction here is expensive — re-reading is sometimes
    // right. Stating what happened lets the model draw its own conclusion.
    const note = repetitionHandoffNote([repeat('agent-session.read', 61)])!;
    expect(note).not.toMatch(/\b(do not|don't|you must|stop|never)\b/i);
    expect(note).toContain('ALREADY TRIED');
  });

  it('says nothing when there is nothing to say', () => {
    expect(repetitionHandoffNote([])).toBeNull();
  });

  it('does not change the report-not-stop behaviour (acceptance 3)', () => {
    // W21-19's founder-facing line is untouched and still says the run was not
    // stopped — the two say the same thing to different readers.
    const repeats = [repeat('agent-session.read', 61)];
    expect(repetitionEvidenceLine(repeats)).toContain('did not stop the run');
    expect(repetitionHandoffNote(repeats)).not.toBeNull();
  });
});
