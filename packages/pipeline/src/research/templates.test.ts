import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RESEARCH_TEMPLATES,
  UnknownResearchTemplateError,
  getResearchTemplate,
  templatesForPhase,
} from './templates.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('RESEARCH_TEMPLATES (FR-P8 AC-2)', () => {
  it('ships exactly the five phase 0/1/3/4 templates BLUEPRINT names', () => {
    expect(RESEARCH_TEMPLATES.map((t) => t.id)).toEqual([
      'market-research',
      'feasibility',
      'design-options',
      'build-vs-adopt',
      'pre-code-api-verification',
    ]);
  });

  it('maps each template to its BLUEPRINT §3.2 phase', () => {
    expect(RESEARCH_TEMPLATES.map((t) => t.phaseId)).toEqual([0, 1, 3, 3, 4]);
  });

  it('every contentPath resolves to a real file under content/research-templates/', () => {
    for (const template of RESEARCH_TEMPLATES) {
      expect(template.contentPath.startsWith('content/research-templates/')).toBe(true);
      const fullPath = join(repoRoot, template.contentPath);
      expect(existsSync(fullPath), `missing ${template.contentPath}`).toBe(true);
      const body = readFileSync(fullPath, 'utf8');
      expect(body.length).toBeGreaterThan(0);
    }
  });

  it('getResearchTemplate resolves a known id', () => {
    expect(getResearchTemplate('market-research').title).toBe('Market Research');
  });

  it('getResearchTemplate throws UnknownResearchTemplateError on an unknown id', () => {
    expect(() => getResearchTemplate('does-not-exist')).toThrow(
      UnknownResearchTemplateError,
    );
  });

  it('templatesForPhase groups phase-3 templates together', () => {
    expect(templatesForPhase(3).map((t) => t.id)).toEqual([
      'design-options',
      'build-vs-adopt',
    ]);
  });

  it('templatesForPhase returns empty for a phase with no research template', () => {
    expect(templatesForPhase(2)).toEqual([]);
  });
});
