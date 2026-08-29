import { describe, expect, it } from 'vitest';
import { reportFatal, STACK_ENV_VAR } from './fatal.js';

function capture(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line) => lines.push(line) };
}

describe('reportFatal', () => {
  it('refuses with the message, not a stack trace', () => {
    const out = capture();
    const err = new Error('no such project database: /nope/state.db');
    err.stack = 'Error: no such project database\n    at Object.<anonymous> (/x/y.js:1:1)';
    reportFatal(err, out.sink, {});

    const text = out.lines.join('\n');
    expect(text).toContain('refused: no such project database: /nope/state.db');
    expect(text).not.toContain('at Object.<anonymous>');
  });

  it('says how to get the stack back, so one silence is not traded for another', () => {
    const out = capture();
    reportFatal(new Error('boom'), out.sink, {});
    expect(out.lines.join('\n')).toContain(`${STACK_ENV_VAR}=1`);
  });

  it('prints the full stack when asked', () => {
    const out = capture();
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at deep (/x/y.js:9:9)';
    reportFatal(err, out.sink, { [STACK_ENV_VAR]: '1' });

    const text = out.lines.join('\n');
    expect(text).toContain('at deep (/x/y.js:9:9)');
    expect(text).not.toContain('refused:');
  });

  it('calls an empty-message error unexpected rather than dressing it as a refusal', () => {
    const out = capture();
    reportFatal(new TypeError(''), out.sink, {});

    const text = out.lines.join('\n');
    expect(text).toContain('carrying no message');
    expect(text).toContain('TypeError');
    expect(text).not.toContain('refused:');
  });

  it('handles a thrown non-Error', () => {
    const out = capture();
    reportFatal('plain string failure', out.sink, {});
    expect(out.lines.join('\n')).toContain('refused: plain string failure');
  });

  it('falls back to the message when an Error carries no stack', () => {
    const out = capture();
    const err = new Error('stackless');
    err.stack = undefined;
    reportFatal(err, out.sink, { [STACK_ENV_VAR]: '1' });
    expect(out.lines.join('\n')).toContain('stackless');
  });
});
