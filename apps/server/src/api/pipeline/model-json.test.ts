/**
 * W10-59 red fixtures. Both directions, because a tolerance that tolerates
 * everything is not a parser: fenced output must parse to the same object its
 * unfenced twin does, AND genuinely malformed output must still raise
 * `MalformedModelOutputError` naming its phase.
 *
 * The fenced case here is the real one — the exact shape that killed a live
 * pipeline run in a browser on 2026-08-03, after two phases had already
 * completed against a local model.
 */

import { describe, expect, it } from 'vitest';
import { MalformedModelOutputError } from './errors.js';
import { parseModelJson, stripCodeFence } from './model-json.js';

const OBJECT = { tickets: [{ id: 'T-1', title: 'Seed the map' }] };
const BODY = JSON.stringify(OBJECT, null, 2);

describe('parseModelJson — output that already worked keeps working', () => {
  it('parses a bare JSON object unchanged', () => {
    expect(parseModelJson(BODY, 'ticket-drafts')).toEqual(OBJECT);
  });

  it('parses a bare object with surrounding whitespace', () => {
    expect(parseModelJson(`\n\n  ${BODY}\n `, 'ticket-drafts')).toEqual(OBJECT);
  });
});

describe('parseModelJson — fenced output parses to the same object', () => {
  const fenced: readonly [string, string][] = [
    ['```json fence', '```json\n' + BODY + '\n```'],
    ['bare ``` fence', '```\n' + BODY + '\n```'],
    ['uppercase language tag', '```JSON\n' + BODY + '\n```'],
    ['tilde fence', '~~~json\n' + BODY + '\n~~~'],
    ['four-backtick fence', '````json\n' + BODY + '\n````'],
    ['leading + trailing whitespace', '\n  ```json\n' + BODY + '\n```  \n'],
    [
      'prose before the fence',
      'Here is the JSON you asked for:\n```json\n' + BODY + '\n```',
    ],
    [
      'prose after the fence',
      '```json\n' + BODY + '\n```\nLet me know if you want changes.',
    ],
    ['unterminated fence (truncated completion)', '```json\n' + BODY],
  ];

  for (const [label, content] of fenced) {
    it(`tolerates ${label}`, () => {
      expect(parseModelJson(content, 'ticket-drafts')).toEqual(OBJECT);
    });
  }

  it('takes the FIRST fenced block when a model emits two', () => {
    const two = '```json\n' + BODY + '\n```\n\n```json\n{"tickets":[]}\n```';
    expect(parseModelJson(two, 'ticket-drafts')).toEqual(OBJECT);
  });
});

describe('parseModelJson — the refusal is still real', () => {
  it('raises on a completion with no JSON in it at all', () => {
    expect(() => parseModelJson('not json at all', 'blueprint-input')).toThrow(
      MalformedModelOutputError,
    );
  });

  it('raises on an empty completion', () => {
    expect(() => parseModelJson('   \n  ', 'blueprint-input')).toThrow(
      MalformedModelOutputError,
    );
  });

  it('raises on a fence containing prose rather than JSON', () => {
    expect(() =>
      parseModelJson('```json\nI could not produce that.\n```', 'technical-slate-input'),
    ).toThrow(MalformedModelOutputError);
  });

  it('raises on truncated JSON rather than repairing it', () => {
    // The half-object is deliberately unbalanced: a JSON *repairer* would
    // close the brace and invent a ticket. This is fence stripping, not repair.
    expect(() =>
      parseModelJson('```json\n{"tickets": [{"id": "T-1"', 'ticket-drafts'),
    ).toThrow(MalformedModelOutputError);
  });

  it('raises when the completion parses to a non-object', () => {
    expect(() => parseModelJson('```json\n["a","b"]\n```', 'ticket-drafts')).toThrow(
      MalformedModelOutputError,
    );
  });

  it('names the phase in the refusal, so a sequential run says which call failed', () => {
    expect(() => parseModelJson('not json at all', 'ticket-drafts')).toThrow(
      /ticket-drafts/,
    );
  });
});

describe('stripCodeFence', () => {
  it('returns unfenced content unchanged, byte for byte', () => {
    expect(stripCodeFence(BODY)).toBe(BODY);
  });

  it('returns the body of a fenced block', () => {
    expect(stripCodeFence('```json\n' + BODY + '\n```').trim()).toBe(BODY);
  });
});
