/**
 * W17-02: the budget-stop checkpoint — parsed strictly, rendered as one
 * line, never a guess.
 */
import { describe, expect, it } from 'vitest';
import {
  checkpointStderrLine,
  extractSessionCheckpoint,
  parseCheckpointReply,
} from './session-checkpoint.js';

describe('session checkpoint (W17-02)', () => {
  it('round-trips through the stderr line', () => {
    const checkpoint = {
      completed: ['schema drafted'],
      remaining: ['validation rules', 'tests'],
      next: 'write the validation rules file',
    };
    const extracted = extractSessionCheckpoint(
      `agent session stopped: budget\n${checkpointStderrLine(checkpoint)}`,
    );
    expect(extracted).toEqual(checkpoint);
  });

  it('parses a chatty reply that wraps the JSON, and rejects garbage rather than guessing', () => {
    expect(
      parseCheckpointReply('Sure! {"completed":["a"],"remaining":[],"next":"b"} hope that helps'),
    ).toEqual({ completed: ['a'], remaining: [], next: 'b' });
    expect(parseCheckpointReply('no json here')).toBeNull();
    expect(parseCheckpointReply('{"completed":[],"remaining":[],"next":""}')).toBeNull();
    expect(parseCheckpointReply('{"completed":"not-an-array","next":42}')).toBeNull();
  });

  it('output with no marker yields null — a retry without a checkpoint is a fresh start, honestly', () => {
    expect(extractSessionCheckpoint('plain session output')).toBeNull();
  });
});
