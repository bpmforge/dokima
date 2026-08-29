/**
 * W21-66. Model size and agentic tool-use ability are different axes, and the
 * ladder only knew the first. The numbers in these fixtures are REAL, taken
 * from this machine's three project ledgers on 2026-08-29 — not invented to
 * make a threshold look reasonable.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, openEventLog, type EventLog } from '@dokima/events';
import {
  cannotActAgentically,
  modelToolProfiles,
  unfitRungNotice,
} from './loop-land-policy.js';

describe('model size and agentic tool use are different axes (W21-66)', () => {
  const dirs: string[] = [];
  const logs: EventLog[] = [];

  afterEach(() => {
    for (const log of logs.splice(0)) log.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function ledger(): EventLog {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dokima-profile-'));
    dirs.push(dir);
    const log = openEventLog(path.join(dir, 'state.db'));
    logs.push(log);
    createIdentity(log, { id: 'agent', name: 'Agent', kind: 'machine' });
    return log;
  }

  const turn = (log: EventLog, model: string) =>
    appendEvent(log, {
      eventType: 'spend.recorded',
      actorId: 'agent',
      ticketId: 'T-1',
      payload: { model, completionTokens: 10 },
    });

  const call = (log: EventLog, toolId: string) =>
    appendEvent(log, {
      eventType: 'mcp.tool_call.completed',
      actorId: 'agent',
      ticketId: 'T-1',
      payload: { toolId },
    });

  it('RED FIXTURE: a tool call belongs to the turn BEFORE it, not the one after', () => {
    // The direction that matters. A turn completes, spend.recorded is written,
    // and only THEN are that turn's requested tool calls executed. Attributing
    // forward is invisible inside a single-model session and wrong exactly at
    // a rung boundary — the only place this mechanism is ever used.
    const log = ledger();
    turn(log, 'writer');
    call(log, 'agent-session.write');
    turn(log, 'browser');
    call(log, 'agent-session.read');

    const profiles = modelToolProfiles(log);
    expect(profiles.get('writer')?.mutations).toBe(1);
    expect(profiles.get('browser')?.mutations).toBe(0);
    expect(profiles.get('browser')?.calls).toBe(1);
  });

  it('reproduces the measured vault profile: 106 calls, zero mutations', () => {
    // Real, from this machine's ledger on 2026-08-29: qwen/qwen3.8-27b made
    // read x66 and list x40 on that project and changed nothing at all.
    const log = ledger();
    turn(log, 'qwen/qwen3.8-27b');
    for (let i = 0; i < 66; i += 1) call(log, 'agent-session.read');
    for (let i = 0; i < 40; i += 1) call(log, 'agent-session.list');

    const profile = modelToolProfiles(log).get('qwen/qwen3.8-27b')!;
    expect(profile.calls).toBe(106);
    expect(profile.mutations).toBe(0);
    expect(cannotActAgentically(profile)).toBe(true);
  });

  it('the SAME model that mutates elsewhere is NOT condemned — the judgement is per project', () => {
    // Also real: qwen/qwen3.8-27b mutated 11 of 81 calls on a different
    // project on the same machine. That is why this cannot be a list of model
    // names, and why the profile is read from the project's own ledger.
    const log = ledger();
    turn(log, 'qwen/qwen3.8-27b');
    for (let i = 0; i < 70; i += 1) call(log, 'agent-session.read');
    for (let i = 0; i < 11; i += 1) call(log, 'agent-session.edit');

    const profile = modelToolProfiles(log).get('qwen/qwen3.8-27b')!;
    expect(profile.mutations).toBe(11);
    expect(cannotActAgentically(profile)).toBe(false);
  });

  it('a small sample is not a finding', () => {
    // Below the floor, "it never mutated" is noise. The smallest real profile
    // that DOES mutate is 81 calls; the floor sits under it at 50.
    const log = ledger();
    turn(log, 'quiet');
    for (let i = 0; i < 20; i += 1) call(log, 'agent-session.read');
    expect(cannotActAgentically(modelToolProfiles(log).get('quiet'))).toBe(false);
  });

  it('an unknown model is not condemned by absence of evidence', () => {
    expect(cannotActAgentically(undefined)).toBe(false);
  });

  it('counts write, edit and commit as mutations — the same set W17-01 uses', () => {
    const log = ledger();
    turn(log, 'm');
    for (const tool of ['write', 'edit', 'commit', 'read', 'list']) {
      call(log, `agent-session.${tool}`);
    }
    const profile = modelToolProfiles(log).get('m')!;
    expect(profile.mutations).toBe(3);
    expect(profile.calls).toBe(5);
  });

  it('the notice says what it saw and that the verdict can change', () => {
    const notice = unfitRungNotice('qwen/qwen3.8-27b', {
      model: 'qwen/qwen3.8-27b',
      turns: 43,
      calls: 106,
      mutations: 0,
    });
    expect(notice).toContain('106 tool call');
    expect(notice).toContain('changed NOTHING');
    expect(notice).toContain('stops being skipped');
  });
});
