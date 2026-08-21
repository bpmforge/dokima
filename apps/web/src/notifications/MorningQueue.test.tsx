// @vitest-environment jsdom
/**
 * W10-80. Measured in a browser the day slate-backed Decide cards first became
 * reachable (W10-73): the queue rendered "Approve" and "Reject" for a founder
 * slate, clicking Approve resolved the card, and the SAME card returned a
 * second later with a new timestamp — because `decideNotification` closes the
 * notification and never touches the slate, which is still open and still
 * needs an answer.
 *
 * The behaviour was right and the buttons were not: a founder slate carries
 * 2-4 named options with tradeoffs and a recommendation, so answering means
 * CHOOSING one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as notificationsApi from './api.js';
import * as decisionsApi from '../decisions/api.js';
import { MorningQueue } from './MorningQueue.js';
import type { NotificationItem } from './types.js';
import type { SlateRecord } from '../decisions/types.js';

vi.mock('./api.js', () => ({
  fetchMorningQueue: vi.fn(),
  decideApproval: vi.fn(),
  NotificationsApiError: class extends Error {},
}));
vi.mock('../decisions/api.js', () => ({
  fetchSlates: vi.fn(),
  decideSlate: vi.fn(),
}));

const notifications = vi.mocked(notificationsApi);
const decisions = vi.mocked(decisionsApi);

const SLATE: SlateRecord = {
  id: 'slate-1',
  status: 'open',
  slate: {
    kind: 'founder',
    title: 'Ship the offline queue in v1 or defer it',
    options: [
      { id: 'ship', label: 'Ship it in v1', tradeoffs: 'Works on bad signal.' },
      { id: 'defer', label: 'Defer to v1.1', tradeoffs: 'Launch sooner.' },
    ],
    recommendedId: 'ship',
    recommendedReasoning: 'Bad signal is the primary persona.',
  },
  chosen: null,
  rationale: null,
  d_id: null,
  decided_by: null,
  decided_at: null,
  created_at: '2026-08-04T00:00:00.000Z',
};

function card(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'note-1',
    tier: 'decide',
    kind: 'clarification',
    refType: 'slate',
    refId: 'slate-1',
    title: 'Ship the offline queue in v1 or defer it',
    body: {},
    leverage: 20,
    status: 'open',
    pushedAt: null,
    createdAt: '2026-08-04T00:00:00.000Z',
    resolvedAt: null,
    projectId: 'proj-1',
    projectName: 'Loopdemo',
    ...overrides,
  } as NotificationItem;
}

describe('a slate-backed Decide card is answered, not approved (W10-80)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decisions.fetchSlates.mockResolvedValue([SLATE]);
    decisions.decideSlate.mockResolvedValue({} as never);
  });

  afterEach(cleanup);

  it('RED FIXTURE: offers the slate options, and no Approve/Reject that cannot answer it', async () => {
    notifications.fetchMorningQueue.mockResolvedValue([card()]);

    render(<MorningQueue />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-slate-slate-1')).toBeTruthy();
    });
    expect(screen.getByText('Ship it in v1')).toBeTruthy();
    expect(screen.getByText('Defer to v1.1')).toBeTruthy();
    // A control that resolves the card while leaving the question open is the
    // whole defect — it must not be offered for this kind of card.
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('choosing an option decides the SLATE and never the notification', async () => {
    notifications.fetchMorningQueue.mockResolvedValue([card()]);

    render(<MorningQueue />);
    await waitFor(() => expect(screen.getByTestId('queue-slate-slate-1')).toBeTruthy());

    fireEvent.click(screen.getByRole('radio', { name: /Defer to v1.1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));

    await waitFor(() => {
      expect(decisions.decideSlate).toHaveBeenCalledWith(
        'proj-1',
        'slate-1',
        expect.objectContaining({ chosen: 'defer' }),
      );
    });
    // Resolving the card by hand would fight W10-73's reconcile pass, which
    // closes it once the slate is no longer open.
    expect(notifications.decideApproval).not.toHaveBeenCalled();
  });

  it('an ordinary Decide card still gets Approve/Reject — this narrows nothing else', async () => {
    notifications.fetchMorningQueue.mockResolvedValue([
      card({ id: 'note-2', kind: 'approval', refType: 'ticket', refId: 'T-1' }),
    ]);

    render(<MorningQueue />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
  });

  it('a slate answered elsewhere says so rather than offering a choice that would 409', async () => {
    notifications.fetchMorningQueue.mockResolvedValue([card()]);
    decisions.fetchSlates.mockResolvedValue([]);

    render(<MorningQueue />);

    await waitFor(() => {
      expect(screen.getByText(/Already answered/)).toBeTruthy();
    });
  });
});

describe('a tool-approval card shows the work (W14-04, the W13-61 standard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decisions.fetchSlates.mockResolvedValue([]);
  });
  afterEach(cleanup);

  const toolCard = () =>
    card({
      id: 'mcp-approval-appr-1',
      kind: 'approval',
      refType: 'mcp_tool_call',
      refId: 'appr-1',
      title: 'Tool approval: srv-x.deploy',
      body: {
        serverId: 'srv-x',
        toolId: 'srv-x.deploy',
        args: { env: 'prod' },
        argsDigest: 'abcdef0123456789abcd',
        requestedBy: 'worker-1',
        ticketId: 'T-1',
      },
    });

  it('RED FIXTURE: the exact requested arguments are on the card, with mechanism-true consequence copy — never a bare "a tool wants to run"', async () => {
    notifications.fetchMorningQueue.mockResolvedValue([toolCard()]);

    render(<MorningQueue />);
    await waitFor(() => screen.getByTestId('mcp-approval-evidence'));

    const evidence = screen.getByTestId('mcp-approval-evidence');
    expect(evidence.textContent).toContain('srv-x.deploy');
    expect(screen.getByTestId('mcp-approval-args').textContent).toContain('"env": "prod"');
    expect(evidence.textContent).toContain('exactly these arguments');

    // Mechanism-true (external-tools.ts): the click records; the tool runs
    // on a later pass, not now.
    const consequence = screen.getByText(/Approve records your decision/);
    expect(consequence.textContent).toContain('next time an agent asks');
    expect(consequence.textContent).toContain('nothing ever runs');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
  });
});
