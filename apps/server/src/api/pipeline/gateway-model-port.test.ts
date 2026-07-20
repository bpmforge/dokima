import { afterEach, describe, expect, it } from 'vitest';
import {
  createRealGatewayPort,
  MalformedModelOutputError,
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

describe('gateway-model-port — real gateway wiring (dynamic import, no package.json dependency)', () => {
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
