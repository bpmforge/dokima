// @vitest-environment jsdom
/**
 * W13-02. Four defects on one screen, all found by walking the live app.
 * This is the screen a person meets when they first try to describe what they
 * want built, and it was the second place the founder got stuck.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InterviewPanel } from './InterviewPanel.js';
import { INTERVIEW_QUESTIONS } from './interview-topics.js';

afterEach(cleanup);

function renderPanel(projectName = 'Untitled') {
  return render(
    <InterviewPanel
      projectId="p1"
      projectName={projectName}
      onComplete={vi.fn()}
    />,
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
      'it inherited the plain-button pill and never read as the screen\'s action',
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
    expect((screen.getByTestId('interview-run') as HTMLButtonElement).disabled).toBe(false);
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
