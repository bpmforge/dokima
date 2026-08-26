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
