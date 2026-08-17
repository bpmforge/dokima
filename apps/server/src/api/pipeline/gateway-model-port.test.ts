import { afterEach, describe, expect, it } from 'vitest';
import {
  createRealGatewayPort,
  MalformedModelOutputError,
  providerForConfig,
} from './gateway-model-port.js';
import { startFakeGatewayServer, type FakeGatewayServer } from './test-fake-gateway.js';
// Imported from its chapter, not the barrel: gateway-model-port.ts does not
// re-export the prompt and is outside this ticket's write_scope, so widening
// its public surface for a test is not this ticket's call to make.
import { BLUEPRINT_SYSTEM_PROMPT } from './gateway-model-port/blueprint-phase.js';

const VALID_BLUEPRINT_INPUT = {
  sections: [{ heading: 'Overview', body: 'A demo project.' }],
  openQuestions: [
    {
      key: 'deployment-shape',
      slate: {
        title: 'Deployment shape?',
        options: [
          { id: 'self-hosted', label: 'Self-hosted', tradeoffs: 'more ops work' },
          { id: 'managed', label: 'Managed', tradeoffs: 'vendor lock-in' },
        ],
        recommendedId: 'managed',
        recommendedReasoning: 'fastest to ship',
      },
    },
  ],
};

const VALID_TECHNICAL_SLATE_INPUT = {
  title: 'Storage approach',
  options: [
    {
      label: 'Minimal',
      summary: 'Flat files',
      dimensions: {
        time: 'fast',
        maintainability: 'low',
        scalability: 'low',
        'team-fit': 'ok',
        risk: 'low',
        reversibility: 'high',
      },
    },
    {
      label: 'Clean',
      summary: 'A real database',
      dimensions: {
        time: 'slow',
        maintainability: 'high',
        scalability: 'high',
        'team-fit': 'ok',
        risk: 'medium',
        reversibility: 'medium',
      },
    },
    {
      label: 'Pragmatic',
      summary: 'SQLite',
      dimensions: {
        time: 'medium',
        maintainability: 'medium',
        scalability: 'medium',
        'team-fit': 'ok',
        risk: 'low',
        reversibility: 'medium',
      },
    },
  ],
  recommendedLabel: 'Pragmatic',
  recommendedConstraint: 'ship in one week',
};

const VALID_TICKET_DRAFTS = {
  tickets: [
    {
      id: 'T-1',
      type: 'task',
      title: 'Build the thing',
      writeScope: ['apps/demo/**'],
      dependsOn: [],
      acceptance: ['It works'],
      verify: 'pnpm test',
      ownPackage: 'apps/demo',
      importsWorkspacePackages: [],
      providesInterfaces: [],
      consumesInterfaces: [],
    },
  ],
};

describe('gateway-model-port — real gateway wiring (workspace dependency)', () => {
  let server: FakeGatewayServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('resolveBlueprintInput calls the real OaiCompatProvider and parses a valid completion', async () => {
    server = await startFakeGatewayServer([JSON.stringify(VALID_BLUEPRINT_INPUT)]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    const result = await port.resolveBlueprintInput([], 'Demo Project');

    expect(result.title).toBe('Demo Project');
    expect(result.sections).toEqual(VALID_BLUEPRINT_INPUT.sections);
    expect(result.openQuestions).toHaveLength(1);
    expect(result.openQuestions[0]?.key).toBe('deployment-shape');
    expect(server.requests[0]?.model).toBe('local-model');
  });

  it('resolveTechnicalSlateInput parses a valid completion', async () => {
    server = await startFakeGatewayServer([JSON.stringify(VALID_TECHNICAL_SLATE_INPUT)]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    const result = await port.resolveTechnicalSlateInput({
      document: { version: 1, markdown: '# Demo' },
      slates: [],
    });

    expect(result.options).toHaveLength(3);
    expect(result.recommendedLabel).toBe('Pragmatic');
  });

  it('resolveTicketDrafts parses a valid completion', async () => {
    server = await startFakeGatewayServer([JSON.stringify(VALID_TICKET_DRAFTS)]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    const result = await port.resolveTicketDrafts(
      { document: { version: 1, markdown: '# Demo' }, slates: [] },
      {
        kind: 'technical',
        title: 'Storage',
        options: [],
        recommendedLabel: 'Pragmatic',
        recommendedConstraint: 'ship in one week',
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('T-1');
    expect(result[0]?.verify).toBe('pnpm test');
  });

  /**
   * W10-63. W10-59 made `parseModelJson` fence-tolerant and covered it with 20
   * unit tests — none of which touch this file. Revert `chat-json.ts` to a bare
   * `JSON.parse(response.message.content)` and all 20 stay green, along with
   * the whole suite and every e2e: the parser still works, the pipeline just
   * stops using it. These two cases are the assertion that the phases go
   * through it, and they fail on that revert.
   *
   * The fenced payload is the real shape, not an invented one — a ```json
   * block is what a live LM Studio returned for ticket-drafts on 2026-08-03,
   * after blueprint and technical-slate had already completed.
   */
  const fenced = (value: unknown): string =>
    '```json\n' + JSON.stringify(value, null, 2) + '\n```';

  it('resolveTicketDrafts parses a FENCED completion — the phase that failed in production', async () => {
    server = await startFakeGatewayServer([fenced(VALID_TICKET_DRAFTS)]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    const result = await port.resolveTicketDrafts(
      { document: { version: 1, markdown: '# Demo' }, slates: [] },
      {
        kind: 'technical',
        title: 'Storage',
        options: [],
        recommendedLabel: 'Pragmatic',
        recommendedConstraint: 'ship in one week',
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('T-1');
    expect(result[0]?.verify).toBe('pnpm test');
  });

  it('resolveBlueprintInput parses a FENCED completion identically to its unfenced twin', async () => {
    server = await startFakeGatewayServer([fenced(VALID_BLUEPRINT_INPUT)]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    const result = await port.resolveBlueprintInput([], 'Demo Project');

    expect(result.sections).toEqual(VALID_BLUEPRINT_INPUT.sections);
    expect(result.openQuestions[0]?.key).toBe('deployment-shape');
  });

  it('throws MalformedModelOutputError on a non-JSON completion', async () => {
    server = await startFakeGatewayServer(['not json at all']);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    await expect(port.resolveBlueprintInput([], 'Demo')).rejects.toBeInstanceOf(
      MalformedModelOutputError,
    );
  });

  it('throws MalformedModelOutputError when a required field is missing', async () => {
    server = await startFakeGatewayServer([JSON.stringify({ sections: [] })]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    await expect(port.resolveBlueprintInput([], 'Demo')).rejects.toBeInstanceOf(
      MalformedModelOutputError,
    );
  });

  it('throws MalformedModelOutputError when an array field is the wrong shape', async () => {
    server = await startFakeGatewayServer([JSON.stringify({ tickets: 'not-an-array' })]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    await expect(
      port.resolveTicketDrafts(
        { document: { version: 1, markdown: '# Demo' }, slates: [] },
        {
          kind: 'technical',
          title: 'Storage',
          options: [],
          recommendedLabel: 'Pragmatic',
          recommendedConstraint: 'ship in one week',
        },
      ),
    ).rejects.toBeInstanceOf(MalformedModelOutputError);
  });
});

/**
 * W10-03: before this ticket every production call built an oai-compat
 * adapter unconditionally, so the ollama/lm-studio/anthropic/vertex/copilot
 * adapters were never constructed outside their own tests. The dispatch is
 * what makes them reachable.
 */
describe('providerForConfig — adapter dispatch (W10-03, W12-11)', () => {
  it('constructs the adapter the resolved KIND names, not always oai-compat', async () => {
    const base = { baseUrl: 'http://127.0.0.1:11434/v1', model: 'm' };
    expect((await providerForConfig({ ...base, kind: 'ollama' })).id).toContain('ollama');
    expect((await providerForConfig({ ...base, kind: 'lm-studio' })).id).toContain(
      'lm-studio',
    );
    // Absent kind keeps the pre-registry behaviour, so nothing regresses.
    expect((await providerForConfig({ ...base })).id).toBeTruthy();
  });

  it(
    'W12-11: anthropic and openai now CONSTRUCT with a resolved credential and a ' +
      'real price table — the refusal this test used to assert was removed by ' +
      'fixing its two stated causes, not by waiving it',
    async () => {
      const prev = process.env.DOKIMA_MODEL_API_KEY;
      process.env.DOKIMA_MODEL_API_KEY = 'test-key';
      try {
        const anthropic = await providerForConfig({
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-5',
          kind: 'anthropic',
        });
        expect(anthropic.id).toBeTruthy();
        const openai = await providerForConfig({
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5',
          kind: 'openai',
        });
        expect(openai.id).toBeTruthy();
      } finally {
        if (prev === undefined) delete process.env.DOKIMA_MODEL_API_KEY;
        else process.env.DOKIMA_MODEL_API_KEY = prev;
      }
    },
  );

  it('W12-11 RED FIXTURE: an UNPRICED model refuses rather than metering a paid API at $0', async () => {
    const prev = process.env.DOKIMA_MODEL_API_KEY;
    process.env.DOKIMA_MODEL_API_KEY = 'test-key';
    try {
      await expect(
        providerForConfig({
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-not-in-the-price-map',
          kind: 'openai',
        }),
      ).rejects.toThrowError(/no price is on record/);
    } finally {
      if (prev === undefined) delete process.env.DOKIMA_MODEL_API_KEY;
      else process.env.DOKIMA_MODEL_API_KEY = prev;
    }
  });

  it('W12-11 RED FIXTURE: a paid kind with NO credential refuses rather than calling unauthenticated', async () => {
    const prev = process.env.DOKIMA_MODEL_API_KEY;
    delete process.env.DOKIMA_MODEL_API_KEY;
    try {
      await expect(
        providerForConfig({
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5',
          kind: 'openai',
        }),
      ).rejects.toThrowError(/needs a credential/);
    } finally {
      if (prev !== undefined) process.env.DOKIMA_MODEL_API_KEY = prev;
    }
  });

  it(
    'W12-11 RED FIXTURE (the $0 loophole): a PAID host reached through the generic ' +
      'oai-compat path gets a real price table — pointing DOKIMA_MODEL_BASE_URL at ' +
      'api.openai.com used to meter every call at $0 and leave the breakers unable to fire',
    async () => {
      const prev = process.env.DOKIMA_MODEL_API_KEY;
      process.env.DOKIMA_MODEL_API_KEY = 'test-key';
      try {
        // No `kind` at all — the env path's shape, which is how the loophole
        // was reached. An unpriced model on a paid host must now refuse.
        await expect(
          providerForConfig({
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-not-in-the-price-map',
          }),
        ).rejects.toThrowError(/no price is on record/);
        // A local endpoint stays free, because it genuinely is.
        const local = await providerForConfig({
          baseUrl: 'http://127.0.0.1:1234/v1',
          model: 'anything-local',
        });
        expect(local.id).toBeTruthy();
      } finally {
        if (prev === undefined) delete process.env.DOKIMA_MODEL_API_KEY;
        else process.env.DOKIMA_MODEL_API_KEY = prev;
      }
    },
  );

  it(
    'W12-14 RED FIXTURE: vertex CONSTRUCTS once the entry says which project and ' +
      'region get billed — it was the one cloud kind still refusing after W12-11 ' +
      'solved credentials and pricing, purely because the registry could not ' +
      'express those two fields',
    async () => {
      const provider = await providerForConfig({
        model: 'gemini-2.5-pro',
        kind: 'vertex',
        baseUrl: '',
        project: 'my-gcp-project',
        location: 'us-central1',
      });
      expect(provider.id).toBeTruthy();
    },
  );

  it(
    'W12-14 RED FIXTURE: a vertex entry missing project or location refuses BY NAME, ' +
      'naming which field — a default here would be a guess about whose cloud bill ' +
      'this lands on',
    async () => {
      await expect(
        providerForConfig({ model: 'gemini-2.5-pro', kind: 'vertex', baseUrl: '' }),
      ).rejects.toThrowError(/requires project/);
      await expect(
        providerForConfig({
          model: 'gemini-2.5-pro',
          kind: 'vertex',
          baseUrl: '',
          project: 'my-gcp-project',
        }),
      ).rejects.toThrowError(/requires location/);
    },
  );

  it('an unpriced vertex model still refuses rather than metering a paid API at $0', async () => {
    await expect(
      providerForConfig({
        model: 'gemini-not-in-the-price-map',
        kind: 'vertex',
        baseUrl: '',
        project: 'p',
        location: 'us-central1',
      }),
    ).rejects.toThrowError(/no price is on record/);
  });
});

/**
 * W10-65. The fake gateway serves `responses` in order and repeats the last
 * entry, which is exactly the shape needed here: [deviating, valid] proves the
 * retry recovers, [deviating] alone proves it still gives up.
 *
 * The deviating payload is the real one — a live local model returned a
 * blueprint whose `openQuestions[0].slate.recommendedId` was empty on
 * 2026-08-03, and that one field discarded a 90-second run.
 */
describe('gateway-model-port — one bounded retry with the gap fed back (W10-65)', () => {
  let server: FakeGatewayServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  const DEVIATING_BLUEPRINT = JSON.stringify({
    sections: [{ heading: 'Overview', body: 'A demo project.' }],
    openQuestions: [
      {
        key: 'deployment-shape',
        slate: {
          title: 'Deployment shape?',
          options: [
            { id: 'self-hosted', label: 'Self-hosted', tradeoffs: 'more ops work' },
            { id: 'managed', label: 'Managed', tradeoffs: 'vendor lock-in' },
          ],
          recommendedId: '',
          recommendedReasoning: 'fastest to ship',
        },
      },
    ],
  });

  it('recovers when the model corrects itself on the second attempt', async () => {
    server = await startFakeGatewayServer([
      DEVIATING_BLUEPRINT,
      JSON.stringify(VALID_BLUEPRINT_INPUT),
    ]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    const result = await port.resolveBlueprintInput([], 'Demo Project');

    expect(result.openQuestions[0]?.slate.recommendedId).toBe('managed');
    expect(server.requests).toHaveLength(2);
  });

  it('feeds the SPECIFIC failing path back, not a bare try-again', async () => {
    server = await startFakeGatewayServer([
      DEVIATING_BLUEPRINT,
      JSON.stringify(VALID_BLUEPRINT_INPUT),
    ]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    await port.resolveBlueprintInput([], 'Demo Project');

    const retry = server.requests[1] as {
      messages: { role: string; content: string }[];
    };
    const userTurn = retry.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userTurn).toContain('openQuestions[0].slate.recommendedId');
    expect(userTurn).toContain('was rejected');
  });

  it('still raises when the model deviates every time — the retry is bounded at one', async () => {
    server = await startFakeGatewayServer([DEVIATING_BLUEPRINT]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    await expect(port.resolveBlueprintInput([], 'Demo Project')).rejects.toBeInstanceOf(
      MalformedModelOutputError,
    );
    expect(server.requests).toHaveLength(2);
  });

  it('names the phase and both attempts when it gives up', async () => {
    server = await startFakeGatewayServer([DEVIATING_BLUEPRINT]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    await expect(port.resolveBlueprintInput([], 'Demo Project')).rejects.toThrow(
      /blueprint-input.*after one retry with the gap fed back/s,
    );
  });

  it('does NOT retry a transport failure — that would double a wait the user is already holding', async () => {
    const port = await createRealGatewayPort({
      baseUrl: 'http://127.0.0.1:9/v1', // discard port: connection refused
      model: 'local-model',
    });

    await expect(port.resolveBlueprintInput([], 'Demo Project')).rejects.not.toBeInstanceOf(
      MalformedModelOutputError,
    );
  });
});

/**
 * W10-66. The open-question key becomes a bare token inside a
 * `<!-- FOUNDER-DECISION: <key> UNRESOLVED -->` sentinel matched by a
 * fail-closed grammar, so a title with spaces breaks FR-P7's phase lock. The
 * prompt used to ask for `"key": string` and nothing more.
 *
 * Validating at the PORT (rather than letting the downstream 422 stand) is
 * what makes this recoverable: it becomes a phase-named
 * MalformedModelOutputError, which is exactly what W10-65's retry feeds back.
 */
describe('gateway-model-port — open-question keys are slugs, and a bad one is retryable (W10-66)', () => {
  let server: FakeGatewayServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  const withKey = (key: string): string =>
    JSON.stringify({
      ...VALID_BLUEPRINT_INPUT,
      openQuestions: [
        { ...VALID_BLUEPRINT_INPUT.openQuestions[0], key },
      ],
    });

  const TITLE_KEY = 'Offline Sync & Conflict Resolution Strategy';

  it('the system prompt states the slug rule with a worked example, not just a regex', () => {
    expect(BLUEPRINT_SYSTEM_PROMPT).toContain('offline-sync');
    expect(BLUEPRINT_SYSTEM_PROMPT).toContain('SLUG');
  });

  it('recovers from the real failure: a human-readable key, corrected on retry', async () => {
    server = await startFakeGatewayServer([
      withKey(TITLE_KEY),
      withKey('offline-sync'),
    ]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    const result = await port.resolveBlueprintInput([], 'Demo Project');

    expect(result.openQuestions[0]?.key).toBe('offline-sync');
    expect(server.requests).toHaveLength(2);
  });

  it('tells the model which path was wrong and where the readable wording belongs', async () => {
    server = await startFakeGatewayServer([withKey(TITLE_KEY), withKey('offline-sync')]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    await port.resolveBlueprintInput([], 'Demo Project');

    const retry = server.requests[1] as { messages: { role: string; content: string }[] };
    const userTurn = retry.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userTurn).toContain('openQuestions[0].key');
    expect(userTurn).toContain('slate title');
  });

  it('still refuses a key that stays malformed — it is a boundary, not a suggestion', async () => {
    server = await startFakeGatewayServer([withKey(TITLE_KEY)]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    await expect(port.resolveBlueprintInput([], 'Demo Project')).rejects.toBeInstanceOf(
      MalformedModelOutputError,
    );
  });

  it('does not slugify on the model behalf — a key it never sent is never invented', async () => {
    server = await startFakeGatewayServer([withKey(TITLE_KEY)]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    await expect(port.resolveBlueprintInput([], 'Demo Project')).rejects.toThrow(
      /must be a slug/,
    );
  });

  it('a well-formed slug passes through untouched', async () => {
    server = await startFakeGatewayServer([withKey('deployment-shape')]);
    const port = await createRealGatewayPort({
      baseUrl: server.url,
      model: 'local-model',
    });

    const result = await port.resolveBlueprintInput([], 'Demo Project');

    expect(result.openQuestions[0]?.key).toBe('deployment-shape');
    expect(server.requests).toHaveLength(1);
  });
});
