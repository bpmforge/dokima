/**
 * Phase-gate input tree (W9-06, FR-P2: "the receipt carries the input-file content
 * hashes FR-P2 later recomputes, so a silently edited doc invalidates it").
 *
 * Deliverable contents are ALWAYS read here, off the real `projectRoot` — the exact
 * same root `runPhaseGate` hands `runValidatorPack` as `cwd` — never accepted as a
 * caller-supplied parameter. Accepting caller-supplied file contents would be a
 * self-attestation seam: a caller could hand in stale or fabricated content and the
 * receipt's `inputTreeHash` would silently agree with it instead of the real tree the
 * validators just checked.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ReceiptInputFile } from '@dokima/events';
import { isPathDeliverable, type PhaseDefinition } from '@dokima/pipeline';

export class PhaseDeliverableMissingError extends Error {
  constructor(
    public readonly phaseId: number,
    public readonly missing: readonly string[],
  ) {
    super(
      `phase ${phaseId} gate refused — declared deliverable(s) not found on disk: ` +
        missing.join(', '),
    );
    this.name = 'PhaseDeliverableMissingError';
  }
}


/**
 * Reads every path-shaped deliverable for a phase off `projectRoot`. Throws
 * `PhaseDeliverableMissingError` (fail-closed, caller treats as gate refusal) if any
 * declared doc is absent — a phase gate over a partially-produced deliverable set is
 * not a real run.
 */
export async function readPhaseInputFiles(
  phase: PhaseDefinition,
  projectRoot: string,
): Promise<ReceiptInputFile[]> {
  const pathDeliverables = phase.deliverables.filter((d) => isPathDeliverable(d.id));
  const missing: string[] = [];
  const files: ReceiptInputFile[] = [];

  for (const deliverable of pathDeliverables) {
    const absolute = path.join(projectRoot, deliverable.id);
    try {
      const content = await fs.readFile(absolute, 'utf8');
      files.push({ path: deliverable.id, content });
    } catch {
      missing.push(deliverable.id);
    }
  }

  if (missing.length > 0) {
    throw new PhaseDeliverableMissingError(phase.id, missing);
  }

  return files;
}
