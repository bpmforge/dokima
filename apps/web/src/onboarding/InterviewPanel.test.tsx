// @vitest-environment jsdom
/**
 * W13-02. Four defects on one screen, all found by walking the live app.
 * This is the screen a person meets when they first try to describe what they
 * want built, and it was the second place the founder got stuck.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as onboardingApi from './api.js';
import { InterviewPanel } from './InterviewPanel.js';

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return {
    ...actual,
    fetchFollowUpQuestion: vi.fn().mockResolvedValue(null),
    // W16-06: the failure-path tests reject this; everything else never runs it.
    runGuidedPipeline: vi.fn(),
    // Mount recovery finds nothing active — these tests own what happens next.
    fetchActiveRun: vi.fn().mockResolvedValue(null),
    // W18-02: undescribed by default; the recap tests override this.
    fetchPlannedTicketCount: vi.fn().mockResolvedValue(0),
  };
});
import { INTERVIEW_QUESTIONS } from './interview-topics.js';

afterEach(cleanup);

function renderPanel(projectName = 'Untitled') {
  return render(
    <InterviewPanel projectId="p1" projectName={projectName} onComplete={vi.fn()} />,
  );
}

describe('the title trap (W13-02)', () => {
  it(
    'RED FIXTURE: the title field is not pre-filled with a value that only ' +
      'looks like an answer. "Untitled" was seeded as the VALUE, so the field ' +
      'read as answered while the primary stayed disabled',
    () => {
      renderPanel('Untitled');
      const title = screen.getByTestId('interview-title') as HTMLInputElement;
      expect(title.value).toBe('');
      expect(title.placeholder).toBe('Untitled');
    },
  );

  it('a REAL project name is still offered, because that one is an answer', () => {
    renderPanel('Recipe Box');
    expect((screen.getByTestId('interview-title') as HTMLInputElement).value).toBe(
      'Recipe Box',
    );
  });
});

describe('the disabled primary says what IT is waiting for (W13-02)', () => {
  it(
    'RED FIXTURE: names the precondition that is ACTUALLY unmet. The old copy ' +
      'said "Answer at least one question and give it a title" no matter which ' +
      'was missing — and since the title was pre-filled with "Untitled", the ' +
      'title half was already satisfied. It blamed something the user had done',
    () => {
      renderPanel('Recipe Box');
      // Title present, no answers: only the answer half is outstanding.
      expect(screen.getByTestId('interview-blocked').textContent).toMatch(/question/i);
      expect(screen.getByTestId('interview-blocked').textContent).not.toMatch(/title/i);
    },
  );

  it('names the title when THAT is the missing half', () => {
    renderPanel('Untitled');
    fireEvent.change(screen.getByTestId('interview-answer-docs/VISION.md'), {
      target: { value: 'A thing that does a thing.' },
    });
    expect(screen.getByTestId('interview-blocked').textContent).toMatch(/title/i);
  });

  it(
    'is styled as the primary even while disabled — it had NO class at all, so ' +
      "it inherited the plain-button pill and never read as the screen's action",
    () => {
      renderPanel();
      expect(screen.getByTestId('interview-run').className).toContain('btn-primary');
    },
  );

  it('says nothing once it can actually run', () => {
    renderPanel('Recipe Box');
    fireEvent.change(screen.getByTestId('interview-answer-docs/VISION.md'), {
      target: { value: 'A thing that does a thing.' },
    });
    expect(screen.queryByTestId('interview-blocked')).toBeNull();
    expect((screen.getByTestId('interview-run') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe('internal names do not reach the person answering (W13-02)', () => {
  it(
    'RED FIXTURE: no "Drafts:" caption. Every field was captioned with an ' +
      'artifact name — Drafts: Vision, Drafts: Scope, Drafts: User personas — ' +
      'which VOCABULARY.md already forbids: internal terms are for wire shapes, ' +
      'not for the person being asked a question',
    () => {
      const { container } = renderPanel();
      expect(container.textContent).not.toMatch(/Drafts:/);
      expect(container.textContent).not.toMatch(/User personas/);
    },
  );
});

describe('the form declares its length before you start (W13-02)', () => {
  it(
    'RED FIXTURE: says how many questions there are. Eight of them, no count, ' +
      'no grouping, and no sign that blanks are fine until you reach a disabled ' +
      'button at the bottom',
    () => {
      renderPanel();
      // Against the real constant, not a literal I counted off a screenshot —
      // I counted nine and there are eight, and a hardcoded number would go
      // stale the first time a question is added.
      expect(screen.getByTestId('interview-progress').textContent).toContain(
        `${INTERVIEW_QUESTIONS.length} questions`,
      );
    },
  );

  it('counts what you have answered, so progress is visible while you work', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('interview-answer-docs/VISION.md'), {
      target: { value: 'A thing.' },
    });
    expect(screen.getByTestId('interview-progress').textContent).toContain(
      `1 of ${INTERVIEW_QUESTIONS.length}`,
    );
  });
});

/**
 * W13-18 (AC-1: "Interview adapts question depth to my answers"). The engine
 * that does this shipped in W5-02 and had no production caller; users got a
 * second, static interview instead.
 */
describe('adaptive follow-ups (W13-18)', () => {
  it(
    'RED FIXTURE: answering a question can produce a follow-up. The panel asked ' +
      'eight fixed questions and never one more, whatever the answer said',
    async () => {
      vi.mocked(onboardingApi).fetchFollowUpQuestion.mockResolvedValue(
        'Who is it for, specifically?',
      );
      renderPanel();
      fireEvent.change(screen.getByTestId('interview-answer-docs/VISION.md'), {
        target: { value: 'A tool that proves its work.' },
      });
      fireEvent.click(screen.getByTestId('interview-more-docs/VISION.md'));

      expect(await screen.findByText('Who is it for, specifically?')).toBeTruthy();
    },
  );

  it(
    'offers nothing to ask until the question is answered — and never asks on ' +
      'its own. The first version fetched on blur, which spent a model call ' +
      'every time the cursor left a field',
    () => {
      vi.mocked(onboardingApi).fetchFollowUpQuestion.mockClear();
      renderPanel();
      expect(screen.queryByTestId('interview-more-docs/VISION.md')).toBeNull();
      fireEvent.change(screen.getByTestId('interview-answer-docs/VISION.md'), {
        target: { value: 'A tool.' },
      });
      // Now offered — but still not called until asked for.
      expect(screen.getByTestId('interview-more-docs/VISION.md')).toBeTruthy();
      expect(vi.mocked(onboardingApi).fetchFollowUpQuestion).not.toHaveBeenCalled();
    },
  );

  it(
    'no follow-up is a working interview, not a broken one. A local-only user ' +
      'with no model reachable still answers every opening question (C-1)',
    async () => {
      vi.mocked(onboardingApi).fetchFollowUpQuestion.mockResolvedValue(null);
      renderPanel();
      fireEvent.change(screen.getByTestId('interview-answer-docs/VISION.md'), {
        target: { value: 'A thing.' },
      });
      fireEvent.click(screen.getByTestId('interview-more-docs/VISION.md'));
      await vi.waitFor(() =>
        expect(vi.mocked(onboardingApi).fetchFollowUpQuestion).toHaveBeenCalled(),
      );
      // Still the full opening set, still submittable.
      expect(screen.getByTestId('interview-run')).toBeTruthy();
    },
  );
});

/**
 * W16-06 (novice-journey audit, 2026-08-21). The failed submit rendered
 * `` `${err.message} (HTTP ${status})` `` as the primary error line — a bare
 * exception string on the first screen a novice meets after describing their
 * idea, with no next step.
 */
describe('a failed run speaks novice first (W16-06)', () => {
  async function failRun(err: unknown) {
    vi.mocked(onboardingApi).runGuidedPipeline.mockRejectedValueOnce(err as Error);
    renderPanel('Recipe Box');
    fireEvent.change(screen.getByTestId('interview-answer-docs/VISION.md'), {
      target: { value: 'A thing that does a thing.' },
    });
    fireEvent.click(screen.getByTestId('interview-run'));
    return screen.findByTestId('interview-error');
  }

  it(
    'RED FIXTURE: the primary error line has no "(HTTP" marker and no raw ' +
      'message — plain words and a next step instead',
    async () => {
      const alert = await failRun(new onboardingApi.OnboardingApiError(500, 'boom'));
      expect(alert.textContent).not.toContain('(HTTP');
      expect(alert.textContent).not.toContain('boom');
      expect(alert.textContent).toMatch(/try again/i);
    },
  );

  it('the technical string is kept, demoted to the closed disclosure', async () => {
    await failRun(new onboardingApi.OnboardingApiError(500, 'boom'));
    const detail = screen.getByTestId('interview-error-detail');
    expect(detail.textContent).toContain('Technical detail');
    expect(detail.textContent).toContain('boom (HTTP 500)');
    expect((detail as HTMLDetailsElement).open).toBe(false);
  });

  it('a connection failure blames the server being unreachable, not the person', async () => {
    const alert = await failRun(new TypeError('fetch failed'));
    expect(alert.textContent).toMatch(/couldn't be reached/i);
  });
});

describe('the describe tab never pretends the answers were lost (W18-02)', () => {
  it('RED FIXTURE: a project whose plan has tickets gets the recap, not a bare blank form — the blank form alone read as "your description was lost"', async () => {
    vi.mocked(onboardingApi).fetchPlannedTicketCount.mockResolvedValueOnce(7);
    renderPanel();
    const recap = await screen.findByTestId('interview-described-recap');
    expect(recap.textContent).toContain('7 tickets');
    expect(recap.textContent).toContain('Nothing was lost');
    // W20-05: the heading is persona-voiced now; the recap/first-contact
    // distinction this fixture guards is unchanged.
    expect(screen.getByRole('heading', { name: /start over/ })).toBeTruthy();
  });

  it('a genuinely undescribed project still gets the first-contact form, no recap', async () => {
    renderPanel();
    expect(
      await screen.findByRole('heading', { name: /has some questions/ }),
    ).toBeTruthy();
    expect(screen.queryByTestId('interview-described-recap')).toBeNull();
  });
});
