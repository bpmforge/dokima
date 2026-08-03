import { afterEach, describe, expect, it } from 'vitest';
import {
  createRealGatewayPort,
  MalformedModelOutputError,
  providerForConfig,
} from './gateway-model-port.js';
import { startFakeGatewayServer, type FakeGatewayServer } from './test-fake-gateway.js';

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
describe('providerForConfig — adapter dispatch (W10-03)', () => {
  it('constructs the adapter the resolved KIND names, not always oai-compat', () => {
    const base = { baseUrl: 'http://127.0.0.1:11434/v1', model: 'm' };
    expect(providerForConfig({ ...base, kind: 'ollama' }).id).toContain('ollama');
    expect(providerForConfig({ ...base, kind: 'lm-studio' }).id).toContain('lm-studio');
    // Absent kind keeps the pre-registry behaviour, so nothing regresses.
    expect(providerForConfig({ ...base }).id).toBeTruthy();
  });

  it('REFUSES a cloud kind by name instead of silently falling back to localhost', () => {
    // AnthropicConfig requires a real costTable ("no $0 default for a paid
    // API", its own header) and a RESOLVED secret, not the credentialRef the
    // registry stores. Fabricating either would be a lie about cost or a
    // credential leak, so the port refuses and says why.
    for (const kind of ['anthropic', 'openai', 'vertex', 'copilot'] as const) {
      expect(() =>
        providerForConfig({ baseUrl: 'https://x/v1', model: 'm', kind }),
      ).toThrowError(/not yet constructible/);
    }
  });
});
