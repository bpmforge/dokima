/**
 * Content loader for the agent roster (SRS FR-E2, R-K1): walks
 * `content/experts/**\/*.md`, parses frontmatter (`roster-frontmatter.ts`),
 * and enforces "pin roles, not models" at import — a hardcoded model id
 * inside an expert definition fails the whole load rather than being
 * silently dropped (docs/design/CONTRACTS.md: "no model ids"; SRS FR-E2:
 * "a hardcoded frontier model id inside an expert definition fails
 * import"). `disable: true` entries (the METHODOLOGY/SCHEMA reference docs
 * bundled alongside real experts in the same directories) and files with no
 * `mode` at all (the one shared protocol doc, `PARALLEL_WAVE_PROTOCOL.md`)
 * are reference material, not dispatchable experts — excluded from the
 * roster, same "expert vs reference doc" distinction the content contract
 * itself draws.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseMarkdown, type Frontmatter } from './roster-frontmatter.js';

export const PIN_ROLES_NOT_MODELS_RULE = 'FR-E2: pin roles, not models';

export class RosterContentModelIdError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly modelId: string,
  ) {
    super(
      `${PIN_ROLES_NOT_MODELS_RULE} — refusing to import ${filePath}: hardcoded model id "${modelId}" is not allowed in an expert definition (model assignment belongs to the routing matrix, not the content file)`,
    );
    this.name = 'RosterContentModelIdError';
  }
}

export interface RosterExpert {
  /** Filename stem, e.g. "sdlc-lead" — the stable id used for routing/history lookups. */
  readonly id: string;
  readonly displayName: string;
  /** Immediate subdirectory of contentDir, e.g. "coordinators", "security". */
  readonly cluster: string;
  readonly mode: string;
  readonly description: string;
  readonly filePath: string;
}

function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function extractModelId(frontmatter: Frontmatter): string | undefined {
  const top = frontmatter.model;
  if (typeof top === 'string' && top.trim() !== '') return top;
  const metadata = frontmatter.metadata;
  if (typeof metadata === 'object' && metadata !== null) {
    const nestedModel = (metadata as Record<string, unknown>).model;
    if (typeof nestedModel === 'string' && nestedModel.trim() !== '') return nestedModel;
  }
  return undefined;
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Loads every dispatchable expert under `contentDir` (normally
 * `content/experts`). Throws `RosterContentModelIdError` on the first
 * hardcoded model id encountered — the roster either loads clean or not at
 * all, never a partial list with the violator quietly filtered out.
 */
export async function loadRosterExperts(contentDir: string): Promise<RosterExpert[]> {
  const files = await walkMarkdownFiles(contentDir);
  const experts: RosterExpert[] = [];

  for (const filePath of files.sort()) {
    const raw = await fs.readFile(filePath, 'utf8');
    const { frontmatter } = parseMarkdown(raw);

    const modelId = extractModelId(frontmatter);
    if (modelId !== undefined) {
      throw new RosterContentModelIdError(path.relative(contentDir, filePath), modelId);
    }

    const mode = frontmatter.mode;
    if (typeof mode !== 'string' || mode.trim() === '') continue;
    if (frontmatter.disable === true) continue;

    const id = path.basename(filePath, '.md');
    const cluster = path.relative(contentDir, path.dirname(filePath)) || '.';
    const name = frontmatter.name;
    const description = frontmatter.description;

    experts.push({
      id,
      displayName: typeof name === 'string' && name.trim() !== '' ? name : titleCase(id),
      cluster,
      mode,
      description: typeof description === 'string' ? description : '',
      filePath: path.relative(contentDir, filePath),
    });
  }

  return experts;
}
