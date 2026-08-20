import { useCallback, useState } from 'react';
import { MorningQueue } from '../notifications/MorningQueue.js';
import { fetchGateReceipts, OnboardingApiError, runGuidedPipeline } from './api.js';
import './onboarding.css';
import {
  SAMPLE_BLUEPRINT_TITLE,
  SAMPLE_INTERVIEW_BEATS,
  SAMPLE_INTERVIEW_SESSION,
} from './sample-data.js';
import { isAwaitingDecisions } from './types.js';
import type { GateReceipt, PipelineRunResult } from './types.js';

type Stage = 'interview' | 'ready' | 'running' | 'success' | 'degraded' | 'queue';

function errorMessage(err: unknown): string {
  return err instanceof OnboardingApiError ? err.message : 'The pipeline run failed.';
}

/**
 * Honest degrade copy for a real pipeline run's known non-success outcomes:
 * a founder decision the blueprint raised with no slate UI wired into this
 * walkthrough to resolve it (422, the same gate a real project hits), or a
 * server that hasn't mounted the pipeline route (404 — a misconfigured or
 * out-of-date deployment; `apps/server/src/api/server.ts` registers it by
 * default). Anything else is a generic failure.
 */
function degradeReason(err: unknown): string {
  if (err instanceof OnboardingApiError) {
    if (err.status === 404) {
      return "This server doesn't have the guided-sample pipeline route wired in — the sample can't run for real here.";
    }
    if (err.status === 422) {
      return (
        'The blueprint raised a decision only a founder can make, and this build has ' +
        'no decision-slate UI wired into the guided sample to resolve it — this is ' +
        'the same gate a real project hits, just without the UI to clear it yet.'
      );
    }
  }
  return `The run failed (${errorMessage(err)}) rather than faking success.`;
}

export interface GuidedSampleProps {
  projectId: string;
  onContinue: () => void;
}

/**
 * The guided first-fifteen-minutes sample run (BLUEPRINT §12.3, UX_SPEC
 * §8, FR-C6): plays back the built-in interview, then runs the real
 * blueprint -> decisions -> board pipeline on the project's configured
 * model via `POST .../pipeline/run`. Skippable/resumable via `onContinue`
 * at every stage; never fabricates a result it didn't get from the API.
 */
export function GuidedSample({ projectId, onContinue }: GuidedSampleProps) {
  const [beatIndex, setBeatIndex] = useState(0);
  const [stage, setStage] = useState<Stage>('interview');
  const [result, setResult] = useState<PipelineRunResult | null>(null);
  const [receipts, setReceipts] = useState<GateReceipt[]>([]);
  const [degradeMessage, setDegradeMessage] = useState<string | null>(null);

  const nextBeat = useCallback(() => {
    setBeatIndex((i) => {
      const next = i + 1;
      if (next >= SAMPLE_INTERVIEW_BEATS.length) {
        setStage('ready');
        return i;
      }
      return next;
    });
  }, []);

  const run = useCallback(async () => {
    setStage('running');
    try {
      const runResult = await runGuidedPipeline(projectId, {
        interviewSession: SAMPLE_INTERVIEW_SESSION,
        blueprintTitle: SAMPLE_BLUEPRINT_TITLE,
      });
      // W10-67. The sample's own idea is unlikely to raise a founder decision,
      // but "unlikely" is not "cannot", and treating a paused run as a finished
      // one would show a success screen for a board that does not exist.
      // Reported through the existing degraded path — the honest one — rather
      // than teaching this walkthrough a decision surface it has no room for.
      if (isAwaitingDecisions(runResult)) {
        // W13-38: this used to say "answer it in Decisions to continue", which
        // sent a first-run user to the one place that could not continue the
        // run — the id lived in the interview panel's state and navigating
        // away discarded it. Describe now recovers a waiting run on open, so
        // the sentence names the screen that can actually finish the job.
        setDegradeMessage(
          'The sample paused on a founder decision — that is the gate working, not a ' +
            'failure. Open Describe to answer it and continue the run.',
        );
        setStage('degraded');
        return;
      }
      setResult(runResult);
      const gateReceipts = await fetchGateReceipts(projectId).catch(() => []);
      setReceipts(gateReceipts);
      setStage('success');
    } catch (err) {
      setDegradeMessage(degradeReason(err));
      setStage('degraded');
    }
  }, [projectId]);

  if (stage === 'interview') {
    const beat = SAMPLE_INTERVIEW_BEATS[beatIndex];
    return (
      <div className="guided-sample" data-testid="guided-sample-interview">
        <p className="guided-sample__coach-mark">
          Beat 1 — watch the interview draft each phase-0-2 deliverable from one answer.
        </p>
        <div className="guided-sample__chat-card">
          <p className="guided-sample__question">{beat?.question}</p>
          <p className="guided-sample__answer">{beat?.answer}</p>
          <p className="guided-sample__draft-label">Drafted: {beat?.draftTitle}</p>
        </div>
        <button type="button" onClick={nextBeat} data-testid="guided-sample-next-beat">
          {beatIndex + 1 < SAMPLE_INTERVIEW_BEATS.length
            ? 'Next question'
            : 'Draft complete'}
        </button>
      </div>
    );
  }

  if (stage === 'ready') {
    return (
      <div className="guided-sample" data-testid="guided-sample-ready">
        <p className="guided-sample__coach-mark">
          Beat 2 — run the real blueprint -&gt; decisions -&gt; board pipeline on your
          configured model.
        </p>
        <button type="button" onClick={() => void run()} data-testid="guided-sample-run">
          Run the pipeline
        </button>
        <button type="button" onClick={onContinue}>
          Skip
        </button>
      </div>
    );
  }

  if (stage === 'running') {
    return (
      <p role="status" data-testid="guided-sample-running">
        Running interview -&gt; blueprint -&gt; decisions -&gt; board on your configured
        model&hellip;
      </p>
    );
  }

  if (stage === 'degraded') {
    return (
      <div className="guided-sample" data-testid="guided-sample-degraded">
        <p role="alert" className="guided-sample__degrade">
          {degradeMessage}
        </p>
        <button type="button" onClick={onContinue} data-testid="guided-sample-continue">
          Continue
        </button>
      </div>
    );
  }

  if (stage === 'success' && result) {
    return (
      <div className="guided-sample" data-testid="guided-sample-success">
        <p className="guided-sample__coach-mark">
          Beat 3 — the board built {result.plan.tickets.length} real ticket
          {result.plan.tickets.length === 1 ? '' : 's'} from the decomposed plan.
        </p>
        <ul className="guided-sample__tickets">
          {result.plan_items.map((item) => (
            <li key={item.id}>
              {item.ticket_id ?? item.id} — {item.state}
            </li>
          ))}
        </ul>
        {receipts.length > 0 && (
          <>
            <p className="guided-sample__coach-mark">
              Beat 4 — Gate A minted {receipts.length} receipt
              {receipts.length === 1 ? '' : 's'} as the blueprint unlocked. Open one:
            </p>
            <ul className="guided-sample__receipts" data-testid="guided-sample-receipts">
              {receipts.map((receipt) => (
                <li key={receipt.id}>
                  <code>{receipt.id}</code> — {receipt.kind}
                  {receipt.verify_exit === 0 ? ' (verified)' : ''}
                </li>
              ))}
            </ul>
          </>
        )}
        <button
          type="button"
          onClick={() => setStage('queue')}
          data-testid="guided-sample-show-queue"
        >
          See the morning queue
        </button>
      </div>
    );
  }

  if (stage === 'queue') {
    return (
      <div className="guided-sample" data-testid="guided-sample-queue">
        <p className="guided-sample__coach-mark">
          Beat 5 — this is what a night of autonomous work turns into the next morning:
          leverage-sorted, ten-minute review.
        </p>
        <MorningQueue projectId={projectId} />
        <button type="button" onClick={onContinue} data-testid="guided-sample-continue">
          Continue
        </button>
      </div>
    );
  }

  return null;
}
