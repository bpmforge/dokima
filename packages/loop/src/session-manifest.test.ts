import { describe, expect, it } from 'vitest';
import {
  parseCompletionManifest,
  stripThinking,
  type CompletionManifest,
} from './session-manifest.js';

const MANIFEST: CompletionManifest = {
  ticket: 'W1-06',
  files: ['packages/loop/src/session.ts'],
  verify: { command: 'pnpm test --filter loop', exit: 0 },
  commits: ['a1b2c3d'],
  evidence: ['grep: session runner covers all three parse tiers'],
};

describe('stripThinking', () => {
  it('removes a closed <think> block', () => {
    expect(stripThinking('before<think>secret reasoning</think>after')).toBe(
      'beforeafter',
    );
  });

  it('removes multiple <think> blocks, case-insensitively', () => {
    const input = '<Think>one</Think> keep <THINK>two</THINK>';
    expect(stripThinking(input)).toBe('keep');
  });

  it('strips an unclosed trailing <think> block to end of string', () => {
    expect(stripThinking('kept text<think>unterminated reasoning')).toBe('kept text');
  });

  it('leaves ordinary text untouched', () => {
    expect(stripThinking('no reasoning tags here')).toBe('no reasoning tags here');
  });
});

describe('parseCompletionManifest', () => {
  it('parses tier 1: the whole output is exactly the JSON contract', () => {
    const result = parseCompletionManifest(JSON.stringify(MANIFEST));
    expect(result.tier).toBe('contract');
    expect(result.manifest).toEqual(MANIFEST);
  });

  it('parses tier 1 with surrounding whitespace only', () => {
    const result = parseCompletionManifest(`\n  ${JSON.stringify(MANIFEST)}  \n`);
    expect(result.tier).toBe('contract');
    expect(result.manifest).toEqual(MANIFEST);
  });

  it('parses tier 2: a JSON object embedded in prose', () => {
    const output = `Here is my work summary.\n\n${JSON.stringify(MANIFEST)}\n\nThanks!`;
    const result = parseCompletionManifest(output);
    expect(result.tier).toBe('embedded');
    expect(result.manifest).toEqual(MANIFEST);
  });

  it('parses tier 2 even with apostrophes in surrounding prose', () => {
    const output = `I didn't need to touch anything else. ${JSON.stringify(MANIFEST)} That's it.`;
    const result = parseCompletionManifest(output);
    expect(result.tier).toBe('embedded');
    expect(result.manifest).toEqual(MANIFEST);
  });

  it('parses tier 3: a JSON object inside a fenced code block', () => {
    const output = [
      'Summary prose that is not itself JSON and has a { stray brace.',
      '```json',
      JSON.stringify(MANIFEST),
      '```',
    ].join('\n');
    const result = parseCompletionManifest(output);
    expect(result.tier).toBe('fenced');
    expect(result.manifest).toEqual(MANIFEST);
  });

  it('strips <think> blocks before parsing so reasoning JSON-like content cannot poison extraction', () => {
    const output = `<think>{"not": "a manifest"}</think>${JSON.stringify(MANIFEST)}`;
    const result = parseCompletionManifest(output);
    expect(result.tier).toBe('contract');
    expect(result.manifest).toEqual(MANIFEST);
  });

  it('returns null/null when no tier yields a shape-valid manifest', () => {
    const result = parseCompletionManifest(
      'no manifest anywhere, just prose and a { fragment',
    );
    expect(result.tier).toBeNull();
    expect(result.manifest).toBeNull();
  });

  it('rejects a JSON object missing required manifest fields', () => {
    const result = parseCompletionManifest(JSON.stringify({ ticket: 'W1-06' }));
    expect(result.tier).toBeNull();
    expect(result.manifest).toBeNull();
  });

  it('picks the first shape-valid embedded object over an unrelated one', () => {
    const noise = { hello: 'world' };
    const output = `${JSON.stringify(noise)}\n${JSON.stringify(MANIFEST)}`;
    const result = parseCompletionManifest(output);
    expect(result.tier).toBe('embedded');
    expect(result.manifest).toEqual(MANIFEST);
  });
});
