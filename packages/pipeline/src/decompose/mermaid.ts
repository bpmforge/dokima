import type { DecomposedTicket } from './types.js';

/**
 * Sanitize a free-text label so it stays clean under
 * `content/validators/validate-mermaid.sh`'s static checks (M001/M004
 * unquoted-slash and pipe-in-bracket forms, M003 unicode arrows, M009 smart
 * quotes/em-dash/nbsp, M010 markdown emphasis, M011 `//` comments, M012
 * unbalanced square brackets): strip markdown emphasis/backticks, normalize
 * typographic punctuation to ASCII, drop literal `[`/`]` (an unmatched
 * bracket in a title would otherwise unbalance the node-line bracket count),
 * collapse newlines, and swap `"` for `'` since the label is always wrapped
 * in double quotes below (closes off M001/M004/M007 by construction rather
 * than by escaping).
 */
function sanitizeLabel(text: string): string {
  const cleaned = text
    .replace(/[“”]/g, "'")
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/->/g, 'to')
    .replace(/→/g, 'to')
    .replace(/`/g, "'")
    .replace(/\*\*/g, '')
    .replace(/"/g, "'")
    .replace(/[[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : '(untitled)';
}

/** Node/subgraph ids must never collide with the `end` keyword (M008) and
 * must avoid characters the flowchart grammar treats specially. */
function sanitizeId(prefix: string, raw: string): string {
  const safe = raw.replace(/[^A-Za-z0-9_]/g, '_');
  return `${prefix}${safe}`;
}

/**
 * BLUEPRINT §4 step 4 / US-203: render the DAG as a Mermaid flowchart, one
 * subgraph per lane, edges following `dependsOn`. Deterministic ordering
 * (lane, then ticket id) so re-rendering an unchanged DAG produces an
 * identical diagram — load-bearing for diffing an edited plan.
 */
export function renderMermaid(tickets: readonly DecomposedTicket[]): string {
  const byLane = new Map<string, DecomposedTicket[]>();
  for (const ticket of tickets) {
    const list = byLane.get(ticket.lane) ?? [];
    list.push(ticket);
    byLane.set(ticket.lane, list);
  }

  const lines: string[] = ['flowchart TD'];
  for (const lane of [...byLane.keys()].sort()) {
    const laneTickets = [...(byLane.get(lane) ?? [])].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    lines.push(`  subgraph ${sanitizeId('lane_', lane)}["Lane: ${sanitizeLabel(lane)}"]`);
    for (const ticket of laneTickets) {
      const label = sanitizeLabel(`${ticket.id} ${ticket.title}`);
      lines.push(`    ${sanitizeId('t_', ticket.id)}["${label}"]`);
    }
    lines.push('  end');
  }

  const known = new Set(tickets.map((t) => t.id));
  const sortedTickets = [...tickets].sort((a, b) => a.id.localeCompare(b.id));
  for (const ticket of sortedTickets) {
    const deps = [...ticket.dependsOn].filter((dep) => known.has(dep)).sort();
    for (const dep of deps) {
      lines.push(`  ${sanitizeId('t_', dep)} --> ${sanitizeId('t_', ticket.id)}`);
    }
  }

  return lines.join('\n');
}
