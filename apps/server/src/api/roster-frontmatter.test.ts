import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './roster-frontmatter.js';

describe('parseMarkdown', () => {
  it('parses flat scalar keys (quoted and bare)', () => {
    const raw = [
      '---',
      'name: sdlc-lead',
      'mode: "primary"',
      'disable: true',
      '---',
      '',
      'body text',
    ].join('\n');
    const { frontmatter, body } = parseMarkdown(raw);
    expect(frontmatter).toEqual({ name: 'sdlc-lead', mode: 'primary', disable: true });
    expect(body).toBe('\nbody text');
  });

  it('un-escapes single-quoted YAML with doubled-quote escapes', () => {
    const raw = [
      '---',
      "description: 'End-user guide specialist — turns app-cartographer''s STORIES.md into steps.'",
      '---',
    ].join('\n');
    const { frontmatter } = parseMarkdown(raw);
    expect(frontmatter.description).toBe(
      "End-user guide specialist — turns app-cartographer's STORIES.md into steps.",
    );
  });

  it('preserves colons inside quoted values (only the first colon delimits key/value)', () => {
    const raw = [
      '---',
      "description: 'Ratio 3:1 is the target — see note: important.'",
      '---',
    ].join('\n');
    const { frontmatter } = parseMarkdown(raw);
    expect(frontmatter.description).toBe(
      'Ratio 3:1 is the target — see note: important.',
    );
  });

  it('parses one level of nested mapping under a key with an empty scalar', () => {
    const raw = [
      '---',
      'name: parallel-wave-protocol',
      'metadata:',
      '  type: protocol',
      '---',
    ].join('\n');
    const { frontmatter } = parseMarkdown(raw);
    expect(frontmatter.metadata).toEqual({ type: 'protocol' });
  });

  it('returns empty frontmatter for a file with no leading --- delimiter', () => {
    const { frontmatter, body } = parseMarkdown('# just a heading\n');
    expect(frontmatter).toEqual({});
    expect(body).toBe('# just a heading\n');
  });

  it('returns empty frontmatter when the closing --- is missing', () => {
    const { frontmatter } = parseMarkdown('---\nname: x\n\nno closer here');
    expect(frontmatter).toEqual({});
  });
});
