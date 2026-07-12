import { describe, expect, it } from 'vitest';
import { renderHandoff, type Handoff } from './handoff.js';

const SAMPLE: Handoff = {
  role: 'coding-agent',
  mission: 'implement the ticket',
  ticket: { id: 'W1-06', title: 'HANDOFF contract + agent session runner' },
  context: 'relevant docs, interfaces, prior findings',
  writeScope: ['packages/loop/src/handoff*', 'packages/loop/src/session*'],
  produce: ['acceptance criterion 1', 'acceptance criterion 2'],
  verify: 'pnpm test --filter loop',
};

describe('renderHandoff', () => {
  it('renders the exact universal block format from BLUEPRINT §4', () => {
    expect(renderHandoff(SAMPLE)).toBe(
      [
        '════════════════════════════════════════',
        'ROLE: coding-agent — implement the ticket',
        'TICKET: W1-06 HANDOFF contract + agent session runner',
        'CONTEXT: relevant docs, interfaces, prior findings',
        'WRITE-SCOPE: packages/loop/src/handoff*, packages/loop/src/session*',
        'PRODUCE: acceptance criterion 1; acceptance criterion 2',
        'VERIFY: pnpm test --filter loop',
        'RETURN: Completion Manifest (files produced, verify result, evidence)',
        '════════════════════════════════════════',
      ].join('\n'),
    );
  });

  it('opens and closes with a 40-character rule, matching the BLUEPRINT literal', () => {
    const lines = renderHandoff(SAMPLE).split('\n');
    expect(lines[0]).toBe('═'.repeat(40));
    expect(lines[lines.length - 1]).toBe('═'.repeat(40));
  });

  it('always names Completion Manifest on the RETURN line', () => {
    expect(renderHandoff(SAMPLE)).toContain(
      'RETURN: Completion Manifest (files produced, verify result, evidence)',
    );
  });

  it('renders an empty write-scope as an empty (never omitted) field', () => {
    const rendered = renderHandoff({ ...SAMPLE, writeScope: [] });
    expect(rendered).toContain('WRITE-SCOPE: \n');
  });
});
