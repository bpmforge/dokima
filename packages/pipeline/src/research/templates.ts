/**
 * Research deliverable templates (FR-P8 AC-2): market/feasibility/design-options/
 * build-vs-adopt/pre-code-API-verification, one per research task type BLUEPRINT §3.2 names.
 * Only policy-layer metadata lives here — `id`/`phaseId`/`title`/`contentPath` (a plain
 * `content/research-templates/` path string), same pattern `../phases/topology.ts` already
 * uses for `content/experts`/`content/validators` names. The template bodies live under
 * `content/research-templates/**` (CLAUDE.md law #6: content is data, loaders parse it, code
 * never imports the markdown text itself); four of the five are original Dokima content,
 * and `design-options` is adapted from bpm-opencode-experts — see that directory's
 * VENDORED.md for full provenance.
 */

import type { PhaseId } from './types.js';

export interface ResearchTemplate {
  readonly id: string;
  readonly phaseId: PhaseId;
  readonly title: string;
  readonly contentPath: string;
}

export const RESEARCH_TEMPLATES: readonly ResearchTemplate[] = [
  {
    id: 'market-research',
    phaseId: 0,
    title: 'Market Research',
    contentPath: 'content/research-templates/MARKET_RESEARCH_template.md',
  },
  {
    id: 'feasibility',
    phaseId: 1,
    title: 'Feasibility Study',
    contentPath: 'content/research-templates/FEASIBILITY_template.md',
  },
  {
    id: 'design-options',
    phaseId: 3,
    title: 'Design Options',
    contentPath: 'content/research-templates/DESIGN_OPTIONS_template.md',
  },
  {
    id: 'build-vs-adopt',
    phaseId: 3,
    title: 'Build vs Adopt',
    contentPath: 'content/research-templates/BUILD_VS_ADOPT_template.md',
  },
  {
    id: 'pre-code-api-verification',
    phaseId: 4,
    title: 'Pre-Code API Verification',
    contentPath: 'content/research-templates/PRE_CODE_API_VERIFICATION_template.md',
  },
];

export class UnknownResearchTemplateError extends Error {
  constructor(id: string) {
    super(`no such research template: "${id}"`);
    this.name = 'UnknownResearchTemplateError';
  }
}

export function getResearchTemplate(id: string): ResearchTemplate {
  const template = RESEARCH_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new UnknownResearchTemplateError(id);
  return template;
}

export function templatesForPhase(phaseId: PhaseId): readonly ResearchTemplate[] {
  return RESEARCH_TEMPLATES.filter((t) => t.phaseId === phaseId);
}
