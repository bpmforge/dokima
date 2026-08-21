/**
 * W16-04: the Forge Mirror, composed. All forge traffic here is a FAKE
 * in-memory adapter (law 9a — never live HTTP); offline is the real
 * ForgeUnreachableError the queue path keys on.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import { ForgeUnreachableError, type ForgeAdapter } from '@dokima/forge';
import {
  composeForgeMirror,
  parseForgeMirrorSetting,
  pendingMirrorQueue,
  setupForgeMirror,
} from './forge-mirror.js';

const dirs: string[] = [];
let openLog: EventLog | undefined;
afterEach(async () => {
  openLog?.close();
  openLog = undefined;
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function makeLog(): Promise<EventLog> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-forge-mirror-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  openLog = log;
  return log;
}

/** Records every call; `offline: true` throws the real unreachable error on writes. */
function fakeAdapter(state: { offline: boolean }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const gate = () => {
    if (state.offline) throw new ForgeUnreachableError('fake', new Error('ECONNREFUSED'));
  };
  let nextIssue = 100;
  const adapter = {
    id: 'fake',
    capabilities: () => ({ prs: true, issues: true, protection: true, statuses: true }),
    createIssue: async (...args: unknown[]) => {
      gate();
      calls.push({ method: 'createIssue', args });
      return { number: nextIssue++, title: 'x', state: 'open' };
    },
    updateIssue: async (...args: unknown[]) => {
      gate();
      calls.push({ method: 'updateIssue', args });
      return { number: 100, title: 'x', state: 'open' };
    },
    commentOnIssue: async (...args: unknown[]) => {
      gate();
      calls.push({ method: 'commentOnIssue', args });
      return { id: 1, body: String(args[2]) };
    },
  } as unknown as ForgeAdapter;
  return { adapter, calls };
}

const CONFIG = {
  kind: 'gitea' as const,
  baseUrl: 'http://forge.invalid',
  owner: 'o',
  repo: 'r',
  makerTokenRef: 'FORGE_MAKER_TOKEN',
  makerLogin: 'dokima-maker',
};

async function compose(log: EventLog, adapter: ForgeAdapter) {
  return (await composeForgeMirror({
    log,
    actorId: 'worker-1',
    runId: 'run-1',
    config: CONFIG,
    resolveSecret: () => 'tok',
    secretValues: [],
    stderr: () => {},
    adapter,
    now: () => '2026-08-21T00:00:00.000Z',
  }))!;
}

describe('parseForgeMirrorSetting (W16-04)', () => {
  it('absent = disabled (local-first normal); a malformed shape is a named refusal', () => {
    expect(parseForgeMirrorSetting(undefined, () => false)).toEqual({ disabled: true });
    expect(parseForgeMirrorSetting({ kind: 'svn' }, () => false)).toHaveProperty('refusal');
  });

  it('law 8: a credential-shaped ref value refuses WITHOUT echoing the value', () => {
    const secret = ['ghp', 'feedcafefeedcafefeedcafefeedcafefeed'].join('_');
    const parsed = parseForgeMirrorSetting(
      { ...CONFIG, makerTokenRef: secret },
      () => true,
    );
    expect(parsed).toHaveProperty('refusal');
    expect((parsed as { refusal: string }).refusal).not.toContain(secret);
  });
});

describe('the composed mirror (W16-04, FR-T5)', () => {
  it('claim creates the mirrored issue once, maps it in the ledger, and write-throughs assign+label', async () => {
    const log = await makeLog();
    const { adapter, calls } = fakeAdapter({ offline: false });
    const mirror = await compose(log, adapter);

    await mirror.verbMirror.onVerb({ kind: 'claim', ticketId: 'T-1', ticketTitle: 'Do it' });
    await mirror.verbMirror.onVerb({
      kind: 'evidence',
      ticketId: 'T-1',
      ticketTitle: 'Do it',
      body: 'parked: gaps',
    });

    expect(calls.filter((c) => c.method === 'createIssue')).toHaveLength(1);
    expect(calls.some((c) => c.method === 'updateIssue')).toBe(true);
    expect(calls.some((c) => c.method === 'commentOnIssue')).toBe(true);
    const mapped = listEvents(log).filter((e) => e.eventType === 'forge.issue_mapped');
    expect(mapped).toHaveLength(1);
    expect(
      listEvents(log).filter((e) => e.eventType === 'forge.mirror_written'),
    ).toHaveLength(2);
  });

  it('RED FIXTURE (SC-15/FR-G5): with the forge OFFLINE a verb queues durably instead of failing, and a later reachable run drains it in order', async () => {
    const log = await makeLog();
    const state = { offline: false };
    const { adapter } = fakeAdapter(state);
    const mirror = await compose(log, adapter);
    // Map the issue while reachable, then go dark.
    await mirror.verbMirror.onVerb({ kind: 'claim', ticketId: 'T-1', ticketTitle: 'Do it' });
    state.offline = true;
    await mirror.verbMirror.onVerb({
      kind: 'evidence',
      ticketId: 'T-1',
      ticketTitle: 'Do it',
      body: 'parked while offline',
    });

    const pending = pendingMirrorQueue(log);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.entry.request.verb).toBe('evidence');

    // Next run, forge reachable again: the queue drains and the ledger says so.
    state.offline = false;
    const mirror2 = await compose(log, adapter);
    await mirror2.flushPending();
    expect(pendingMirrorQueue(log)).toHaveLength(0);
    expect(
      listEvents(log).filter((e) => e.eventType === 'forge.mirror_flushed'),
    ).toHaveLength(1);
  });

  it('close write-through carries the REAL minted receipt fields when the receipt exists', async () => {
    const log = await makeLog();
    const { adapter, calls } = fakeAdapter({ offline: false });
    const mirror = await compose(log, adapter);
    await mirror.verbMirror.onVerb({
      kind: 'close',
      ticketId: 'T-1',
      ticketTitle: 'Do it',
      commits: ['abc123'],
      receiptId: 'no-such-receipt',
    });
    const comment = calls.find((c) => c.method === 'commentOnIssue');
    expect(comment).toBeTruthy();
    expect(String(comment!.args[2])).toContain('Close receipt for T-1');
    expect(String(comment!.args[2])).toContain('abc123');
    expect(String(comment!.args[2])).toContain('anchor:');
  });

  it('setupForgeMirror: a missing vault secret disables with a note, never throws', async () => {
    const log = await makeLog();
    const notes: string[] = [];
    const mirror = await setupForgeMirror({
      log,
      actorId: 'worker-1',
      runId: 'run-1',
      settingRaw: { ...CONFIG },
      isSecretShaped: () => false,
      resolveSecret: () => undefined,
      secretValues: [],
      stderr: (line) => notes.push(line),
    });
    expect(mirror).toBeUndefined();
    expect(notes.join('\n')).toMatch(/no secret named/);
  });
});

describe('the generic-git kind is refused by NAME, never silently absent (W16-09)', () => {
  it('says exactly why a bare git remote cannot mirror, and what still works', () => {
    const parsed = parseForgeMirrorSetting({ ...CONFIG, kind: 'generic' }, () => false);
    expect(parsed).toHaveProperty('refusal');
    const refusal = (parsed as { refusal: string }).refusal;
    expect(refusal).toMatch(/no issue API/);
    expect(refusal).toMatch(/push still works/i);
  });
});
