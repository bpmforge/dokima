import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * W10-51. `docs/work/W10_PLAN.md` §2 predicted that the v3.x content refresh
 * would break this parser — "v3.x agents carry a different shape… A refresh
 * that changes frontmatter and leaves the parser alone breaks the roster
 * **while `pnpm test` stays green on the old fixtures**" — and specced a whole
 * ticket to re-baseline it.
 *
 * That premise was measured false before acting on it. The v3 additions (the
 * mandatory HANDOFF-intake block, per-agent WRITE-SCOPE/PRODUCE tables) live in
 * the BODY, which this parser does not read; the frontmatter vocabulary is
 * unchanged. A probe parsed all 94 upstream v3 agents with zero failures, so no
 * parser change shipped.
 *
 * These assertions exist so that conclusion is PINNED rather than re-assumed at
 * the next refresh — the exact "green on old fixtures" trap the plan warned
 * about, pointed at the plan's own claim.
 */
describe('v3 content frontmatter stays within the parsed vocabulary (W10-51)', () => {
  const expertsRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../content/experts',
  );

  const everyExpertFile = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.md')) out.push(full);
      }
    };
    walk(expertsRoot);
    return out;
  };

  it('parses every imported expert without throwing, and each yields a description and a body', () => {
    const files = everyExpertFile();
    // Guards against a silently-empty content tree making this vacuous.
    expect(files.length).toBeGreaterThan(80);
    const broken: string[] = [];
    for (const file of files) {
      try {
        const { frontmatter, body } = parseMarkdown(readFileSync(file, 'utf8'));
        if (typeof frontmatter.description !== 'string' || !frontmatter.description) {
          broken.push(`${path.basename(file)}: no usable description`);
        }
        if (!body.trim()) broken.push(`${path.basename(file)}: empty body`);
      } catch (err) {
        broken.push(`${path.basename(file)}: threw ${(err as Error).message}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('uses no frontmatter key outside the documented vocabulary', () => {
    // If a future refresh introduces a sixth key, this fails HERE — naming it —
    // rather than silently dropping it on the floor at roster-resolve time.
    const DOCUMENTED = new Set(['description', 'mode', 'name', 'disable', 'metadata']);
    const unexpected = new Set<string>();
    for (const file of everyExpertFile()) {
      const { frontmatter } = parseMarkdown(readFileSync(file, 'utf8'));
      for (const key of Object.keys(frontmatter)) {
        if (!DOCUMENTED.has(key)) unexpected.add(`${key} (${path.basename(file)})`);
      }
    }
    expect([...unexpected]).toEqual([]);
  });

  it('every mode value is one the roster understands', () => {
    const VALID = new Set(['primary', 'subagent', 'all']);
    const bad: string[] = [];
    for (const file of everyExpertFile()) {
      const { frontmatter } = parseMarkdown(readFileSync(file, 'utf8'));
      const mode = frontmatter.mode;
      if (mode !== undefined && (typeof mode !== 'string' || !VALID.has(mode))) {
        bad.push(`${path.basename(file)}: mode=${String(mode)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
