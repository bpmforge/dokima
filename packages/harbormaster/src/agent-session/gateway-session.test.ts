import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import {
  CostLedger,
  FitnessCardStore,
  route,
  ROLE_CODING_AGENT,
  type ChatRequest,
  type ChatResponse,
  type ModelInfo,
  type Provider,
  type ProviderHealth,
  type ProviderQueueStats,
  type ScopedRoleMatrix,
} from '@dokima/gateway';
import { git } from '@dokima/git';
import { createTicket, getTicket, type Ticket } from '@dokima/tickets';
import { defaultHandoffBuilder } from '../loop-handoff.js';
import { runLandLoop, type LandLoopOptions, type PushToRemotesFn } from '../loop-land.js';
import {
  createGatewaySpawnSession,
  type GatewaySpawnSessionOptions,
} from './gateway-session.js';
import type { ToolCall } from './gateway-tool-types.js';

const FAKE_MODEL = 'fake/test-model';
const PROJECT_ID = 'proj-w11-02';
const RUN_ID = 'run-w11-02';

const MATRIX: ScopedRoleMatrix = {
  project: {
    [ROLE_CODING_AGENT]: { default: { model: FAKE_MODEL, fallbackChain: [] } },
  },
};

/** A `Provider` that returns one scripted `ChatResponse` per call, in order — no network, per CLAUDE.md law 9. */
class ScriptedFakeProvider implements Provider {
  readonly id = 'fake';
  readonly calls: ChatRequest[] = [];
  private index = 0;

  constructor(private readonly script: readonly ChatResponse[]) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    // Snapshot `messages` — the caller keeps mutating the same array
    // reference on later turns, so recording it live would make every
    // earlier call's `messages` retroactively show the final turn's state.
    this.calls.push({ ...request, messages: [...request.messages] });
    const response = this.script[Math.min(this.index, this.script.length - 1)]!;
    this.index += 1;
    return response;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: FAKE_MODEL }];
  }

  async getContextLength(): Promise<number | undefined> {
    return undefined;
  }

  async health(): Promise<ProviderHealth> {
    return { status: 'ok', checkedAt: '2026-08-05T00:00:00.000Z' };
  }

  async warmUp(): Promise<ProviderHealth> {
    return this.health();
  }

  queueStats(): ProviderQueueStats {
    return { active: 0, queued: 0, concurrency: 1 };
  }
}

function usage(costUsd: number) {
  return { promptTokens: 100, completionTokens: 20, totalTokens: 120, costUsd };
}

function toolCallResponse(calls: ToolCall[], costUsd = 0.002): ChatResponse {
  return {
    model: FAKE_MODEL,
    message: { role: 'assistant', content: '' },
    finishReason: 'tool_calls',
    usage: usage(costUsd),
    toolCalls: calls,
  };
}

function finalResponse(content: string, costUsd = 0.001): ChatResponse {
  return {
    model: FAKE_MODEL,
    message: { role: 'assistant', content },
    finishReason: 'stop',
    usage: usage(costUsd),
  };
}

function manifestJson(ticketId: string, files: readonly string[]): string {
  return JSON.stringify({
    ticket: ticketId,
    files,
    verify: { command: 'true', exit: 0 },
    commits: [],
    evidence: ['ran the closed tool set'],
  });
}

function baseSpawnOptions(
  log: EventLog,
  provider: Provider,
  ledger: CostLedger,
  overrides: Partial<GatewaySpawnSessionOptions> = {},
): GatewaySpawnSessionOptions {
  return {
    log,
    role: ROLE_CODING_AGENT,
    matrix: MATRIX,
    actorId: 'worker-1',
    projectId: PROJECT_ID,
    runId: RUN_ID,
    resolveProvider: () => provider,
    ledger,
    now: () => '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('createGatewaySpawnSession', () => {
  let cwd: string | undefined;
  let dbDir: string | undefined;
  let log: EventLog | undefined;

  afterEach(async () => {
    log?.close();
    log = undefined;
    if (dbDir) await fs.rm(dbDir, { recursive: true, force: true });
    dbDir = undefined;
    if (cwd) await fs.rm(cwd, { recursive: true, force: true });
    cwd = undefined;
  });

  async function setup(): Promise<{ log: EventLog; cwd: string }> {
    dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-agent-session-db-'));
    log = openEventLog(path.join(dbDir, 'state.db'));
    createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-agent-session-cwd-'));
    return { log, cwd };
  }

  it('(acceptance 1) sends the tool schema through the routed model and returns the final message with no manifest yet to parse', async () => {
    const { log, cwd } = await setup();
    const provider = new ScriptedFakeProvider([finalResponse('plain text, no manifest')]);
    const ledger = new CostLedger();
    const spawn = createGatewaySpawnSession(baseSpawnOptions(log, provider, ledger));

    const result = await spawn({
      prompt: 'TICKET: W9-01 Ticket W9-01\nWRITE-SCOPE: **\nVERIFY: true\n',
      cwd,
    });

    expect(result).toEqual({
      stdout: 'plain text, no manifest',
      stderr: '',
      exitCode: 0,
    });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.model).toBe(FAKE_MODEL);
    expect(provider.calls[0]!.tools?.map((t) => t.name).sort()).toEqual(
      ['commit', 'edit', 'list', 'read', 'search', 'verify', 'write'].sort(),
    );
  });

  it('(acceptance 3) every model call records ledger spend attributable to the routed role/model', async () => {
    const { log, cwd } = await setup();
    const provider = new ScriptedFakeProvider([finalResponse('done', 0.0042)]);
    const ledger = new CostLedger();
    const spawn = createGatewaySpawnSession(baseSpawnOptions(log, provider, ledger));

    await spawn({
      prompt: 'TICKET: W9-01 Ticket W9-01\nWRITE-SCOPE: **\nVERIFY: true\n',
      cwd,
    });

    const routed = await route({
      matrix: MATRIX,
      role: ROLE_CODING_AGENT,
      taskType: 'code',
      actorId: 'worker-1',
      fitnessStore: new FitnessCardStore(),
    });
    expect(routed.chain[0]).toBe(FAKE_MODEL);

    const spent = ledger.totalForTicket({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      ticketId: 'W9-01',
    });
    expect(spent).toBeCloseTo(0.0042, 6);
    expect(ledger.allEntries()).toEqual([
      expect.objectContaining({ model: FAKE_MODEL, ticketId: 'W9-01', costUsd: 0.0042 }),
    ]);
  });

  it('executes a returned tool call against the worktree and feeds the result back for the next turn', async () => {
    const { log, cwd } = await setup();
    const write: ToolCall = {
      id: 'call_1',
      name: 'write',
      arguments: { path: 'a.ts', content: 'export const x = 1;\n' },
    };
    const provider = new ScriptedFakeProvider([
      toolCallResponse([write]),
      finalResponse('done'),
    ]);
    const ledger = new CostLedger();
    const spawn = createGatewaySpawnSession(baseSpawnOptions(log, provider, ledger));

    const result = await spawn({
      prompt: 'TICKET: W9-01 Ticket W9-01\nWRITE-SCOPE: **\nVERIFY: true\n',
      cwd,
    });

    expect(result.exitCode).toBe(0);
    await expect(fs.readFile(path.join(cwd, 'a.ts'), 'utf8')).resolves.toBe(
      'export const x = 1;\n',
    );
    expect(provider.calls).toHaveLength(2);
    const secondTurnMessages = provider.calls[1]!.messages;
    const toolResultMessage = secondTurnMessages[secondTurnMessages.length - 1]!;
    expect(toolResultMessage.role).toBe('user');
    expect(toolResultMessage.content).toContain('TOOL_RESULT call_1 (write)');
    expect(toolResultMessage.content).toContain('"ok":true');
  });

  it('(acceptance 6/T-27) a session that never converges stops at the per-session iteration budget, not an unbounded loop', async () => {
    const { log, cwd } = await setup();
    const alwaysToolCalls = new ScriptedFakeProvider([
      toolCallResponse([{ id: 'call_1', name: 'list', arguments: {} }]),
    ]);
    const ledger = new CostLedger();
    const spawn = createGatewaySpawnSession(
      baseSpawnOptions(log, alwaysToolCalls, ledger, { maxIterations: 3 }),
    );

    const result = await spawn({
      prompt: 'TICKET: W9-01 Ticket W9-01\nWRITE-SCOPE: **\nVERIFY: true\n',
      cwd,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('exceeded the per-session tool-iteration budget (3)');
    expect(alwaysToolCalls.calls).toHaveLength(3);
  });

  it('stops once the optional per-session cost cap is reached (the other half of "or the budget stops it")', async () => {
    const { log, cwd } = await setup();
    const provider = new ScriptedFakeProvider([
      toolCallResponse([{ id: 'call_1', name: 'list', arguments: {} }], 0.6),
      toolCallResponse([{ id: 'call_2', name: 'list', arguments: {} }], 0.6),
    ]);
    const ledger = new CostLedger();
    const spawn = createGatewaySpawnSession(
      baseSpawnOptions(log, provider, ledger, { maxIterations: 10, maxCostUsd: 1 }),
    );

    const result = await spawn({
      prompt: 'TICKET: W9-01 Ticket W9-01\nWRITE-SCOPE: **\nVERIFY: true\n',
      cwd,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('per-session cost cap ($1)');
    expect(provider.calls).toHaveLength(2);
  });
});

describe('createGatewaySpawnSession wired into runLandLoop (real close gate, unchanged)', () => {
  const HERE = path.dirname(new URL(import.meta.url).pathname);
  const CONTENT_VALIDATORS_DIR = path.resolve(
    HERE,
    '..',
    '..',
    '..',
    '..',
    'content',
    'validators',
  );
  const TEST_SIGNING_KEY = 'test-agent-session-signing-key';

  let repoRoot: string | undefined;
  let dbDir: string | undefined;
  let log: EventLog | undefined;

  afterEach(async () => {
    log?.close();
    log = undefined;
    if (repoRoot) await fs.rm(repoRoot, { recursive: true, force: true });
    repoRoot = undefined;
    if (dbDir) await fs.rm(dbDir, { recursive: true, force: true });
    dbDir = undefined;
  });

  async function setupRepo(): Promise<{ log: EventLog; repoRoot: string }> {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-agent-session-repo-'));
    await git(repoRoot, ['init', '-b', 'main']);
    await git(repoRoot, ['config', 'user.name', 'Dokima Test']);
    await git(repoRoot, ['config', 'user.email', 'test@dokima.invalid']);
    await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
    await git(repoRoot, ['add', '--', 'README.md']);
    await git(repoRoot, ['commit', '-m', 'chore: initial commit']);

    dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-agent-session-repo-db-'));
    log = openEventLog(path.join(dbDir, 'state.db'));
    createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
    return { log, repoRoot };
  }

  function seedTicket(log: EventLog, id: string): Ticket {
    return createTicket(log, 'worker-1', {
      id,
      type: 'task',
      title: `Ticket ${id}`,
      lane: 'core',
      writeScope: ['packages/example/**'],
      verify: 'true',
    });
  }

  const unusedPushToRemotes: PushToRemotesFn = async () => {
    throw new Error(
      'pushToRemotes invoked with no remotes configured on the fixture repo',
    );
  };

  function baseLandOptions(
    fixture: { log: EventLog; repoRoot: string },
    spawn: LandLoopOptions['spawn'],
  ): LandLoopOptions {
    return {
      log: fixture.log,
      actorId: 'worker-1',
      projectId: PROJECT_ID,
      repoRoot: fixture.repoRoot,
      contentDir: CONTENT_VALIDATORS_DIR,
      signingKey: TEST_SIGNING_KEY,
      spawn,
      pushToRemotes: unusedPushToRemotes,
      buildHandoff: defaultHandoffBuilder(),
      now: () => '2026-08-05T00:00:00.000Z',
    };
  }

  it('(acceptance 4/5, passing) a session that edits a file and commits it via the closed tool set is accepted by the EXISTING close gate, unchanged', async () => {
    const fixture = await setupRepo();
    seedTicket(fixture.log, 'W9-01');

    const provider = new ScriptedFakeProvider([
      toolCallResponse([
        {
          id: 'c1',
          name: 'write',
          arguments: {
            path: 'packages/example/file.ts',
            content: 'export const x = 1;\n',
          },
        },
        {
          id: 'c2',
          name: 'commit',
          arguments: { files: ['packages/example/file.ts'], message: 'feat: add file' },
        },
      ]),
      finalResponse(manifestJson('W9-01', ['packages/example/file.ts'])),
    ]);
    const ledger = new CostLedger();
    const spawn = createGatewaySpawnSession(
      baseSpawnOptions(fixture.log, provider, ledger),
    );

    const result = await runLandLoop(baseLandOptions(fixture, spawn));

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]!.landed).toBe(true);
    expect(result.processed[0]!.attempts[0]!.closeGate?.ok).toBe(true);
    const ticket = getTicket(fixture.log, 'W9-01') as Ticket;
    expect(ticket.status).toBe('in_review');
  });

  it('(acceptance 4/5, refusal) a session that edits a file but commits nothing is refused by the EXISTING close gate with its own reason, never loosened', async () => {
    const fixture = await setupRepo();
    seedTicket(fixture.log, 'W9-01');

    const provider = new ScriptedFakeProvider([
      toolCallResponse([
        {
          id: 'c1',
          name: 'write',
          arguments: {
            path: 'packages/example/file.ts',
            content: 'export const x = 1;\n',
          },
        },
      ]),
      finalResponse(manifestJson('W9-01', ['packages/example/file.ts'])),
    ]);
    const ledger = new CostLedger();
    const spawn = createGatewaySpawnSession(
      baseSpawnOptions(fixture.log, provider, ledger),
    );

    const result = await runLandLoop({
      ...baseLandOptions(fixture, spawn),
      maxLadderAttempts: 1,
    });

    expect(result.processed[0]!.landed).toBe(false);
    const closeGate = result.processed[0]!.attempts[0]!.closeGate;
    expect(closeGate?.ok).toBe(false);
    expect(closeGate?.ok === false && closeGate.reasons).toContainEqual(
      expect.stringContaining(
        'no commits found on the ticket branch since its fork point',
      ),
    );
  });

  it('(acceptance 6) a session whose model never stops calling tools parks the ticket with evidence rather than looping forever', async () => {
    const fixture = await setupRepo();
    seedTicket(fixture.log, 'W9-01');

    const neverConverging = new ScriptedFakeProvider([
      toolCallResponse([{ id: 'c1', name: 'list', arguments: {} }]),
    ]);
    const ledger = new CostLedger();
    const spawn = createGatewaySpawnSession(
      baseSpawnOptions(fixture.log, neverConverging, ledger, { maxIterations: 2 }),
    );

    const result = await runLandLoop({
      ...baseLandOptions(fixture, spawn),
      maxLadderAttempts: 1,
    });

    expect(result.processed[0]!.landed).toBe(false);
    expect(result.processed[0]!.parked).toBe(true);
    expect(result.processed[0]!.parkedReason).toBe('ladder_exhausted');
    expect(result.processed[0]!.attempts[0]!.closeGate).toBeNull();
    expect(result.processed[0]!.attempts[0]!.session.manifest).toBeNull();

    const ticket = getTicket(fixture.log, 'W9-01') as Ticket;
    expect(ticket.status).toBe('ready');
    const comment = ticket.history.find((h) => h.verb === 'comment');
    expect(comment?.body).toContain('auto-blocked with evidence');
  });
});
