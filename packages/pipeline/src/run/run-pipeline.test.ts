import { describe, expect, it, vi } from 'vitest';
import { UnresolvedFounderDecisionError } from '../blueprint/gate.js';
import type { SynthesizeBlueprintInput } from '../blueprint/synth.js';
import {
  InvalidTechnicalSlateError,
  type TechnicalSlateInput,
} from '../decisions/technical-slate.js';
import type { TicketDraftInput } from '../decompose/types.js';
import type { InterviewDeps } from '../interview/session.js';
import { beginTopic, startSession } from '../interview/session.js';
import type {
  AnswerActor,
  DeliverableDraft,
  InterviewSession,
  InterviewTopic,
} from '../interview/types.js';
import { IncompleteInterviewSessionError, runPipeline } from './run-pipeline.js';
import type { PipelineModelPort, PipelinePort, PipelineRunEvent } from './types.js';

const HUMAN: AnswerActor = { id: 'founder-1', kind: 'human' };

const TOPICS: readonly InterviewTopic[] = [
  { phaseId: 0, deliverableId: 'docs/VISION.md' },
  { phaseId: 1, deliverableId: 'docs/SCOPE.md' },
];

/** Draft every topic in one shot — every `nextQuestion` call says "enough
 * signal", so `beginTopic` drafts immediately with zero Q&A turns. */
const NO_QUESTIONS_DEPS: InterviewDeps = {
  nextQuestion: () => null,
  draftDeliverable: (topic) =>
    `# ${topic.deliverableId}\n\ncontent for ${topic.deliverableId}`,
};

function completedSession(): InterviewSession {
  let session = startSession('s1', TOPICS);
  for (let i = 0; i < TOPICS.length; i++) {
    session = beginTopic(session, i, HUMAN, NO_QUESTIONS_DEPS).session;
  }
  return session;
}

function decisionCompleteBlueprintInput(
  title: string,
): (drafts: readonly DeliverableDraft[]) => SynthesizeBlueprintInput {
  return (drafts) => ({
    title,
    sections: drafts.map((d, i) => ({ heading: `Section ${i}`, body: d.content })),
    openQuestions: [],
  });
}

const VALID_TECHNICAL_SLATE_INPUT: TechnicalSlateInput = {
  title: 'How should module boundaries be drawn?',
  options: [
    {
      label: 'Minimal',
      summary: 'One package, no boundaries.',
      dimensions: {
        time: 'fast',
        maintainability: 'poor',
        scalability: 'poor',
        'team-fit': 'ok',
        risk: 'low',
        reversibility: 'high',
      },
    },
    {
      label: 'Clean',
      summary: 'Fully modular from day one.',
      dimensions: {
        time: 'slow',
        maintainability: 'great',
        scalability: 'great',
        'team-fit': 'ok',
        risk: 'medium',
        reversibility: 'medium',
      },
    },
    {
      label: 'Pragmatic',
      summary: 'Modular where it matters, flat elsewhere.',
      dimensions: {
        time: 'medium',
        maintainability: 'good',
        scalability: 'good',
        'team-fit': 'good',
        risk: 'low',
        reversibility: 'medium',
      },
    },
  ],
  recommendedLabel: 'Pragmatic',
  recommendedConstraint: 'small team, must ship in 6 weeks',
};

function ticketDrafts(): readonly TicketDraftInput[] {
  return [
    {
      id: 'T1',
      type: 'task',
      title: 'Build the thing',
      writeScope: ['packages/foo/**'],
      dependsOn: [],
      acceptance: ['does the thing'],
      verify: 'pnpm test',
      ownPackage: 'packages/foo',
      importsWorkspacePackages: [],
      providesInterfaces: [],
      consumesInterfaces: [],
    },
  ];
}

function fakePort(overrides: Partial<PipelineModelPort> = {}): {
  port: PipelinePort;
  events: PipelineRunEvent[];
  model: PipelineModelPort;
} {
  const events: PipelineRunEvent[] = [];
  const model: PipelineModelPort = {
    blueprintInputFrom: decisionCompleteBlueprintInput('Test Blueprint'),
    technicalSlateInputFrom: () => VALID_TECHNICAL_SLATE_INPUT,
    ticketDraftsFrom: () => ticketDrafts(),
    ...overrides,
  };
  const port: PipelinePort = {
    model,
    emit: (event) => events.push(event),
  };
  return { port, events, model };
}

describe('runPipeline (BLUEPRINT §4, phases 0-4)', () => {
  it('AC1/AC2: chains interview -> blueprint -> decisions -> decompose into a well-formed board with the FAKE local port and no network', () => {
    const { port, events } = fakePort();
    const plan = runPipeline(
      {
        interviewSession: completedSession(),
        blueprintTitle: 'Test Blueprint',
        ledgerMarkdown: '',
      },
      port,
    );

    // W21-97: a board built from someone's idea carries its quality work too —
    // the drafted feature, plus the standard checks a person with no
    // development experience would never think to ask for.
    // W21-76: and the phase-0 documents its own gate will check for, without
    // which the project can never leave Idea however much work lands.
    const drafted = plan.tickets.filter(
      (t) => !t.id.startsWith('QUALITY-') && !t.id.startsWith('PHASE0-'),
    );
    expect(drafted).toHaveLength(1);
    expect(plan.tickets.map((t) => t.id)).toEqual(
      expect.arrayContaining(['QUALITY-SECURITY-REVIEW', 'QUALITY-RELEASE-READINESS']),
    );
    // W21-76: the drafted feature is no longer first — the phase-0 documents
    // the gate checks for come ahead of it. It is still the first DRAFTED one.
    expect(drafted[0]?.id).toBe('T1');
    expect(plan.mermaid.startsWith('flowchart TD')).toBe(true);
    expect(plan.violations).toEqual([]);

    expect(events.map((e) => e.kind)).toEqual([
      'interview-complete',
      'blueprint-synthesized',
      'decisions-decided',
      'decomposed',
    ]);
  });

  it('AC2: an incomplete interview session halts with a typed error and produces no board', () => {
    const { port, events } = fakePort();
    const incomplete = startSession('s2', TOPICS); // nothing drafted or skipped

    expect(() =>
      runPipeline(
        {
          interviewSession: incomplete,
          blueprintTitle: 'Test Blueprint',
          ledgerMarkdown: '',
        },
        port,
      ),
    ).toThrow(IncompleteInterviewSessionError);
    expect(events).toEqual([]);
  });

  it('AC2: a blueprint decision-gate failure (unresolved founder-decision marker) halts with no partial board', () => {
    const ticketDraftsFrom = vi.fn(() => ticketDrafts());
    const { port, events } = fakePort({
      blueprintInputFrom: (drafts, title): SynthesizeBlueprintInput => ({
        title,
        sections: drafts.map((d, i) => ({ heading: `Section ${i}`, body: d.content })),
        openQuestions: [
          {
            key: 'deployment-shape',
            slate: {
              title: 'Deployment shape?',
              options: [
                { id: 'a', label: 'Self-hosted', tradeoffs: 'more ops burden' },
                { id: 'b', label: 'Managed', tradeoffs: 'vendor lock-in' },
              ],
              recommendedId: 'a',
              recommendedReasoning: 'matches local-first constraint',
            },
          },
        ],
      }),
      ticketDraftsFrom,
    });

    expect(() =>
      runPipeline(
        {
          interviewSession: completedSession(),
          blueprintTitle: 'Test Blueprint',
          ledgerMarkdown: '', // no D-IDs on file — nothing can be resolved
        },
        port,
      ),
    ).toThrow(UnresolvedFounderDecisionError);

    expect(ticketDraftsFrom).not.toHaveBeenCalled();
    expect(events.map((e) => e.kind)).toEqual([
      'interview-complete',
      'blueprint-synthesized',
    ]);
  });

  it('AC2: a malformed technical-slate from the model port halts before decompose runs', () => {
    const ticketDraftsFrom = vi.fn(() => ticketDrafts());
    const { port, events } = fakePort({
      technicalSlateInputFrom: (): TechnicalSlateInput => ({
        ...VALID_TECHNICAL_SLATE_INPUT,
        options: VALID_TECHNICAL_SLATE_INPUT.options.slice(0, 2), // only 2 of the required 3
      }),
      ticketDraftsFrom,
    });

    expect(() =>
      runPipeline(
        {
          interviewSession: completedSession(),
          blueprintTitle: 'Test Blueprint',
          ledgerMarkdown: '',
        },
        port,
      ),
    ).toThrow(InvalidTechnicalSlateError);

    expect(ticketDraftsFrom).not.toHaveBeenCalled();
    expect(events.map((e) => e.kind)).toEqual([
      'interview-complete',
      'blueprint-synthesized',
    ]);
  });
});

/** The same complete-interview input the AC1 case uses. */
function ideaInput() {
  return {
    interviewSession: completedSession(),
    blueprintTitle: 'Test Blueprint',
    ledgerMarkdown: '',
  };
}

describe('a board carries the documents its own phase gate checks for (W21-76)', () => {
  it(
    'RED FIXTURE: the board contains a ticket for every phase-0 deliverable. ' +
      'Live on Tally the run ended "declared deliverable(s) not found on disk: ' +
      'docs/VISION.md, docs/COMPETITIVE_ANALYSIS.md" with no docs/ directory ' +
      'at all — the gate was right and nothing had ever been asked to feed it',
    () => {
      const plan = runPipeline(ideaInput(), fakePort().port);
      const ids = plan.tickets.map((t) => t.id);
      expect(ids).toContain('PHASE0-VISION');
      expect(ids).toContain('PHASE0-COMPETITIVE_ANALYSIS');
    },
  );

  it('each one writes exactly the path the gate looks for', () => {
    // A ticket that writes somewhere else would leave the gate refusing while
    // the board looked complete — worse than no ticket at all.
    const plan = runPipeline(ideaInput(), fakePort().port);
    const vision = plan.tickets.find((t) => t.id === 'PHASE0-VISION')!;
    expect(vision.writeScope).toEqual(['docs/VISION.md']);
    expect(vision.verify).toBe('test -s docs/VISION.md');
  });

  it('a deliverable that ALREADY exists gains no duplicate ticket', () => {
    // Acceptance 3. A second run must not re-file work the first one did.
    const plan = runPipeline(
      { ...ideaInput(), existingDeliverables: ['docs/VISION.md'] },
      fakePort().port,
    );
    const ids = plan.tickets.map((t) => t.id);
    expect(ids).not.toContain('PHASE0-VISION');
    expect(ids).toContain('PHASE0-COMPETITIVE_ANALYSIS');
  });

  it('a project with every deliverable already present gains none of them', () => {
    const plan = runPipeline(
      {
        ...ideaInput(),
        existingDeliverables: ['docs/VISION.md', 'docs/COMPETITIVE_ANALYSIS.md'],
      },
      fakePort().port,
    );
    expect(plan.tickets.filter((t) => t.id.startsWith('PHASE0-'))).toHaveLength(0);
  });

  it('the deliverable tickets come FIRST, ahead of the features', () => {
    // Ordering is the only signal a person reading the board gets about what
    // has to happen before the phase can advance.
    const plan = runPipeline(ideaInput(), fakePort().port);
    expect(plan.tickets[0]?.id).toMatch(/^PHASE0-/);
  });
});
