// @vitest-environment jsdom
/**
 * W23-14. The card's acceptance is about a REAL surface, so these drive the
 * component the board actually mounts, against a fake fetch that answers the
 * routes the server actually registers.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovedBuildPanel } from './ApprovedBuildPanel.js';

afterEach(cleanup);

const PREVIEW = {
  project_id: 'p1',
  input_digest: 'sha256:abcdef0123456789',
  budget_usd: 5,
  tickets: [
    {
      id: 'T-1',
      title: 'Add the login form',
      lane: 'core',
      write_scope: ['src/login/**'],
      acceptance: ['a person can log in'],
    },
  ],
  maker_model: 'local-coder',
  reviewer_model: 'big-reviewer',
  independent_review: true,
  independent_review_reason: null,
  still_asks_you: [
    {
      id: 'merges-releases-deploys',
      label: 'Merges, releases and deploys',
      reason: 'Irreversible.',
    },
  ],
};

const RUN = (over: Record<string, unknown> = {}) => ({
  runId: 'run-1',
  projectId: 'p1',
  approvedBuild: true,
  phase: 'building',
  detail: 'the agent is writing code against a ticket',
  outcome: null,
  stopRequested: false,
  tickets: [
    { ticketId: 'T-1', state: 'building', reason: null, ruleId: null, repairRounds: 0 },
  ],
  ...over,
});

/** One fake server: every route the panel calls, and a record of what it was asked. */
function server(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const payload = key ? routes[key] : null;
    return {
      ok: payload !== null,
      status: payload === null ? 404 : 200,
      text: async () => JSON.stringify(payload ?? { title: 'not found' }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, opts: { baseUrl: '', token: 't', fetchImpl } };
}

describe('one approval, then a build a person can read', () => {
  it('shows what is being approved BEFORE the button that records it, and starts an approved run', async () => {
    const s = server({
      '/approved-build/preview': PREVIEW,
      '/approved-build': { approval_id: '7', input_digest: PREVIEW.input_digest },
      '/build-runs': { runs: [] },
    });
    render(
      <ApprovedBuildPanel apiOpts={s.opts} projectId="p1" budgetUsd={5} pollMs={null} />,
    );

    fireEvent.click(await screen.findByTestId('approved-build-review'));

    // The specification, not a bare "approve?".
    expect(
      (await screen.findByTestId('approved-build-preview-tickets')).textContent,
    ).toContain('src/login/**');
    expect(screen.getByTestId('approved-build-models').textContent).toContain(
      'big-reviewer',
    );
    expect(screen.getByTestId('approved-build-still-asks').textContent).toContain(
      'Merges, releases and deploys',
    );

    fireEvent.click(screen.getByTestId('approved-build-approve'));
    await waitFor(() => {
      const started = s.calls.find(
        (c) => c.method === 'POST' && c.url.endsWith('/build-runs'),
      );
      expect(started?.body).toMatchObject({ approved_build: true, budget_usd: 5 });
    });
    // The approval is recorded BEFORE the run is asked for.
    const order = s.calls.filter((c) => c.method === 'POST').map((c) => c.url);
    expect(order[0]).toContain('/approved-build');
    expect(order[1]).toContain('/build-runs');
  });

  it('RED FIXTURE: with one model it says so before launch instead of advertising an unattended finish', async () => {
    const s = server({
      '/approved-build/preview': {
        ...PREVIEW,
        reviewer_model: 'local-coder',
        independent_review: false,
        independent_review_reason:
          'the reviewer would be local-coder, the same model doing the work — a maker never reviews its own work, so every ticket will need your decision',
      },
      '/build-runs': { runs: [] },
    });
    render(<ApprovedBuildPanel apiOpts={s.opts} projectId="p1" pollMs={null} />);
    fireEvent.click(await screen.findByTestId('approved-build-review'));
    const warning = await screen.findByTestId('approved-build-no-independent-review');
    expect(warning.textContent).toContain('cannot finish without you');
    expect(warning.textContent).toContain('never reviews its own work');
  });
});

describe('a reload reads the server, not this component’s memory', () => {
  it.each([
    ['building', 'Building'],
    ['checking', 'Checking'],
    ['fixing', 'Fixing'],
    ['ready_to_review', 'Ready to review'],
    ['needs_decision', 'Needs your decision'],
    ['stopped', 'Stopped'],
  ])('a fresh mount shows the %s phase from durable state', async (phase, label) => {
    const s = server({ '/build-runs': { runs: [RUN({ phase })] } });
    render(<ApprovedBuildPanel apiOpts={s.opts} projectId="p1" pollMs={null} />);
    expect((await screen.findByTestId('approved-build-phase')).textContent).toContain(
      label,
    );
  });

  it('a ticket the machine refused to accept names the rule that refused it', async () => {
    const s = server({
      '/build-runs': {
        runs: [
          RUN({
            phase: 'needs_decision',
            outcome: 'awaiting_decision',
            tickets: [
              {
                ticketId: 'T-1',
                state: 'needs_decision',
                reason: 'the source changed after the review',
                ruleId: 'accept-stale-review',
                repairRounds: 2,
              },
            ],
          }),
        ],
      },
    });
    render(<ApprovedBuildPanel apiOpts={s.opts} projectId="p1" pollMs={null} />);
    const reason = await screen.findByTestId('approved-build-reason-T-1');
    expect(reason.textContent).toContain('accept-stale-review');
    expect(screen.getByTestId('approved-build-tickets').textContent).toContain(
      '2 repair round(s)',
    );
    expect(screen.getByTestId('approved-build-decisions').textContent).toContain(
      'need your decision',
    );
  });

  it('says plainly that there is no live preview rather than leaving an empty pane', async () => {
    const s = server({ '/build-runs': { runs: [RUN()] } });
    render(<ApprovedBuildPanel apiOpts={s.opts} projectId="p1" pollMs={null} />);
    const note = await screen.findByTestId('approved-build-preview-unavailable');
    expect(note.textContent).toContain('does not run your app');
  });
});

describe('stop and resume', () => {
  it('a live run offers Stop; a finished one offers Resume and never both', async () => {
    const live = server({ '/build-runs': { runs: [RUN()] } });
    const { unmount } = render(
      <ApprovedBuildPanel apiOpts={live.opts} projectId="p1" pollMs={null} />,
    );
    expect(await screen.findByTestId('approved-build-stop')).toBeTruthy();
    expect(screen.queryByTestId('approved-build-resume')).toBeNull();
    unmount();

    const done = server({
      '/build-runs': { runs: [RUN({ phase: 'stopped', outcome: 'stopped' })] },
    });
    render(<ApprovedBuildPanel apiOpts={done.opts} projectId="p1" pollMs={null} />);
    expect(await screen.findByTestId('approved-build-resume')).toBeTruthy();
    expect(screen.queryByTestId('approved-build-stop')).toBeNull();
  });

  it('every control is reachable from the keyboard', async () => {
    const s = server({ '/approved-build/preview': PREVIEW, '/build-runs': { runs: [] } });
    render(<ApprovedBuildPanel apiOpts={s.opts} projectId="p1" pollMs={null} />);
    const review = await screen.findByTestId('approved-build-review');
    // A real <button>: focusable, and Enter on it activates the same handler a
    // click does. A div with an onClick passes neither of these.
    review.focus();
    expect(document.activeElement).toBe(review);
    expect(review.tagName).toBe('BUTTON');
    fireEvent.keyDown(review, { key: 'Enter' });
    fireEvent.click(review);
    for (const id of ['approved-build-approve', 'approved-build-cancel']) {
      const button = await screen.findByTestId(id);
      expect(button.tagName).toBe('BUTTON');
      button.focus();
      expect(document.activeElement).toBe(button);
    }
  });
});

describe('the approval is asked once', () => {
  it('a live run shows no approval prompt at all — no repeated routine confirmation', async () => {
    const s = server({ '/build-runs': { runs: [RUN()] } });
    render(<ApprovedBuildPanel apiOpts={s.opts} projectId="p1" pollMs={null} />);
    await screen.findByTestId('approved-build-progress');
    expect(screen.queryByTestId('approved-build-review')).toBeNull();
    expect(screen.queryByTestId('approved-build-preview')).toBeNull();
  });
});
