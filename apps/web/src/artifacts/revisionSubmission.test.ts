import { describe, expect, it } from 'vitest';
import { buildCommentSubmission, buildEditSubmission } from './revisionSubmission.js';

describe('buildCommentSubmission', () => {
  it('populates phase for a deliverable in a gated phase (docs/SRS.md, phase 2)', () => {
    const submission = buildCommentSubmission({
      path: 'docs/SRS.md',
      body: 'Please clarify section 2.',
      versionRef: 'HEAD',
    });
    expect(submission).toEqual({
      path: 'docs/SRS.md',
      body: 'Please clarify section 2.',
      versionRef: 'HEAD',
      ticketId: null,
      phase: 2,
    });
  });

  it('sends phase: null for a path that is not a declared deliverable (never gated)', () => {
    const submission = buildCommentSubmission({
      path: 'docs/RANDOM_NOTES.md',
      body: 'not a deliverable',
      versionRef: 'HEAD',
    });
    expect(submission.phase).toBeNull();
  });

  it('passes ticketId through when given', () => {
    const submission = buildCommentSubmission({
      path: 'docs/VISION.md',
      body: 'x',
      versionRef: 'HEAD',
      ticketId: 'W4-05',
    });
    expect(submission.ticketId).toBe('W4-05');
    expect(submission.phase).toBe(0);
  });
});

describe('buildEditSubmission', () => {
  it('carries the full revised content as body, with phase populated the same way', () => {
    const submission = buildEditSubmission({
      path: 'docs/SRS.md',
      content: '# Software Requirements\n\nv2 — revised in place.',
      versionRef: 'abc123',
    });
    expect(submission).toEqual({
      path: 'docs/SRS.md',
      body: '# Software Requirements\n\nv2 — revised in place.',
      versionRef: 'abc123',
      ticketId: null,
      phase: 2,
    });
  });

  it('sends phase: null for a non-deliverable path', () => {
    const submission = buildEditSubmission({
      path: 'docs/SCRATCH.md',
      content: 'whatever',
      versionRef: 'HEAD',
    });
    expect(submission.phase).toBeNull();
  });
});
