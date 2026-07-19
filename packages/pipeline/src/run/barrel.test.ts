import { describe, expect, it } from 'vitest';
import {
  buildTechnicalSlate,
  decompose,
  runPipeline,
  synthesizeBlueprint,
} from '../index.js';

describe('package barrel (W5-17 AC1: the W5-07/W5-10-flagged barrel gap)', () => {
  it('surfaces runPipeline and the interview/blueprint/decisions/decompose phase modules', () => {
    expect(typeof runPipeline).toBe('function');
    expect(typeof synthesizeBlueprint).toBe('function');
    expect(typeof buildTechnicalSlate).toBe('function');
    expect(typeof decompose).toBe('function');
  });
});
