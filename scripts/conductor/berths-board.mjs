// conductor/berths-board.mjs — the P6-07 board-plane bridge, extracted so the
// integration test drives THIS code, not a copy.
//
// In `--engine berths` the goal loop's board is the PRODUCT's event-log DB:
// reads go straight to listTickets (read-only — C-2 forbids untrusted WRITES,
// not reads), and every write goes through the EXISTING `add-ticket` verb via
// the product CLI, never a direct DB write. The measurement plane (SRS,
// proving tests, verify receipt) is unchanged: same product, different board.

import { resolve } from 'node:path';

/** Read-only board snapshot from the product DB, mapped to the loop's row shape. */
export async function readProductBoard({ root, dbPath }) {
  const { openEventLog } = await import('../../packages/events/src/db.ts');
  const { listTickets } = await import('../../packages/tickets/src/query.ts');
  const log = openEventLog(resolve(root, dbPath));
  try {
    return listTickets(log).map((t) => ({
      id: t.id,
      title: t.title,
      lane: t.lane,
      write_scope: t.writeScope ?? [],
      depends_on: t.dependsOn ?? [],
      // product acceptance rows are {id,text,done}; the loop reads strings
      acceptance: (t.acceptance ?? []).map((a) => a?.text ?? String(a)),
      points: 2,
      // The loop's DONE means "proven". `in_review` is landed-but-unaccepted
      // (maker != verifier, a human accepts) and deliberately stays open here.
      status: t.status === 'done' ? 'done' : t.status === 'blocked' ? 'blocked' : 'todo',
      product_status: t.status,
    }));
  } finally {
    log.close?.();
  }
}

/**
 * Write proposals through the add-ticket VERB. A refused proposal (e.g. the
 * LANE_SCOPE invariant) is a loud gap, never a crash — the verb's invariant
 * is the product's law and outranks the proposal.
 * spawn: (cmd, args) => {status, stderr, stdout} — injected (spawnSync in prod).
 */
export function appendProductTickets(rows, { root, dbPath, cliEntry, spawn, verify }) {
  const refused = [];
  for (const r of rows) {
    const args = [
      cliEntry,
      'add-ticket',
      r.id,
      '--actor',
      'product-loop',
      '--lane',
      r.lane ?? 'product',
      '--title',
      r.title,
      '--write-scope',
      (r.write_scope ?? []).join(','),
      '--acceptance',
      (r.acceptance ?? []).join('; '),
      '--verify',
      r.verify ?? verify ?? 'pnpm test',
      '--db',
      resolve(root, dbPath),
    ];
    const out = spawn('node', args);
    if (out.status !== 0) {
      refused.push(
        `add-ticket ${r.id} refused (exit ${out.status}): ${(out.stderr || out.stdout || '').trim().slice(0, 200)}`,
      );
    }
  }
  return refused;
}
