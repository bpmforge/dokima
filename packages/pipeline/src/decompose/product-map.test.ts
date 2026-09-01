import { describe, expect, it } from 'vitest';
import { deriveFeatures } from './features.js';
import { renderProductMap } from './product-map.js';
import type { Seam } from '../seams/types.js';
import type { DecomposedTicket } from './types.js';

function ticket(id: string, title: string): DecomposedTicket {
  return {
    id,
    type: 'task',
    title,
    lane: id,
    writeScope: [],
    dependsOn: [],
    acceptance: [],
    verify: 'true',
  };
}

const REQS = ['US-1', 'US-2'];
const SEAMS: Seam[] = [
  {
    kind: 'export',
    id: 'S-1',
    packageName: '@dokima/auth',
    exportName: 'getSession',
    provider_ticket: 'T-1',
    consumer_ticket: 'T-3',
    wiring_evidence: {
      file: 'packages/auth/src/index.ts',
      exportName: 'getSession',
    },
  },
];

const FIXTURE = [
  ticket('T-1', 'Auth core (US-1)'),
  ticket('T-2', 'Auth UI (US-1)'),
  ticket('T-3', 'Billing (US-2)'),
];

describe('renderProductMap', () => {
  const features = deriveFeatures(FIXTURE, REQS, SEAMS);
  const map = renderProductMap(features, SEAMS);

  it('opens with the shape header', () => {
    expect(map).toContain('# Product Map');
    expect(map).toContain("This is the product's SHAPE");
  });

  it('renders each feature with stories, tickets, seams, and connections', () => {
    expect(map).toContain('## F-US-1 — Auth core (US-1)');
    expect(map).toContain('- Stories: US-1');
    expect(map).toContain('- Tickets: T-1, T-2');
    expect(map).toContain('- Seams: S-1');
    expect(map).toContain('- Connects to:');
    expect(map).toContain('  - F-US-2 — seam S-1: T-1 -> T-3');
    expect(map).toContain('## F-US-2 — Billing (US-2)');
    expect(map).toContain('- Connects to: (nothing)');
  });

  it('renders the seam legend and the final connection table', () => {
    expect(map).toContain('## Seams');
    expect(map).toContain('- S-1 (export): T-1 -> T-3');
    expect(map).toContain('## Connections');
    expect(map).toContain('| From | To | Reason |');
    expect(map).toContain('| F-US-1 | F-US-2 | seam S-1: T-1 -> T-3 |');
  });

  it('says all-clear in the Unmapped section when every ticket serves a story', () => {
    expect(map).toContain('## Unmapped');
    expect(map).toContain('Every ticket serves a story. No unmapped tickets.');
    expect(map).not.toContain('WARNING');
  });

  it('SHOUTS when the unmapped feature is non-empty', () => {
    const withOrphan = deriveFeatures(
      [...FIXTURE, ticket('T-9', 'mystery chore')],
      REQS,
      SEAMS,
    );
    const loud = renderProductMap(withOrphan, SEAMS);
    expect(loud).toContain('**WARNING: TICKETS SERVING NO STORY.**');
    expect(loud).toContain('- T-9');
  });

  it('is deterministic: same features render the same markdown', () => {
    expect(renderProductMap(features, SEAMS)).toBe(map);
  });
});
