/**
 * PRODUCT_MAP.md renderer (P6-01) — the docs artifact that shows the
 * product's SHAPE: which tickets form which feature, which stories each
 * feature serves, which seams it touches, and which features it connects to
 * and WHY. Pure renderer over `deriveFeatures` output — deterministic, no
 * fs, no model judgment; the same features render the same markdown.
 */

import type { Seam } from '../seams/types.js';
import type { Feature } from './types.js';
import { UNMAPPED_FEATURE_ID } from './features.js';

function listLine(label: string, items: readonly string[]): string {
  return `- ${label}: ${items.length > 0 ? items.join(', ') : '(none)'}`;
}

/** Render the feature map as PRODUCT_MAP.md content. */
export function renderProductMap(
  features: readonly Feature[],
  seams: readonly Seam[] = [],
): string {
  const lines: string[] = [
    '# Product Map',
    '',
    "This is the product's SHAPE — how the plan hangs together before any",
    'ticket runs. Tickets that serve the same user stories are one feature;',
    'a seam crossing feature lines is a connection between features, with',
    'the reason stated. A flat ticket list is not a plan; this is.',
    '',
  ];

  const unmapped = features.find((feature) => feature.id === UNMAPPED_FEATURE_ID);
  const mapped = features.filter((feature) => feature.id !== UNMAPPED_FEATURE_ID);

  for (const feature of mapped) {
    lines.push(`## ${feature.id} — ${feature.title}`, '');
    lines.push(listLine('Stories', feature.stories));
    lines.push(listLine('Tickets', feature.tickets));
    lines.push(listLine('Seams', feature.seams));
    if (feature.connects_to.length === 0) {
      lines.push('- Connects to: (nothing)');
    } else {
      lines.push('- Connects to:');
      for (const edge of feature.connects_to) {
        lines.push(`  - ${edge.feature} — ${edge.reason}`);
      }
    }
    lines.push('');
  }

  lines.push('## Unmapped', '');
  if (unmapped === undefined || unmapped.tickets.length === 0) {
    lines.push('Every ticket serves a story. No unmapped tickets.', '');
  } else {
    lines.push(
      '**WARNING: TICKETS SERVING NO STORY.** The following tickets cite no',
      'user story or requirement — either the ticket is unnecessary, or the',
      'story it serves is missing from the SRS. Resolve before building:',
      '',
    );
    for (const ticketId of unmapped.tickets) {
      lines.push(`- ${ticketId}`);
    }
    lines.push('');
  }

  const referenced = new Set(features.flatMap((feature) => feature.seams));
  const legend = seams.filter((seam) => referenced.has(seam.id));
  if (legend.length > 0) {
    lines.push('## Seams', '');
    for (const seam of legend) {
      const wire =
        seam.provider_ticket !== undefined && seam.consumer_ticket !== undefined
          ? `: ${seam.provider_ticket} -> ${seam.consumer_ticket}`
          : '';
      lines.push(`- ${seam.id} (${seam.kind})${wire}`);
    }
    lines.push('');
  }

  lines.push('## Connections', '');
  const edges = mapped.flatMap((feature) =>
    feature.connects_to.map((edge) => ({ from: feature.id, ...edge })),
  );
  if (edges.length === 0) {
    lines.push('No cross-feature connections.', '');
  } else {
    lines.push('| From | To | Reason |', '| --- | --- | --- |');
    for (const edge of edges) {
      lines.push(`| ${edge.from} | ${edge.feature} | ${edge.reason} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
