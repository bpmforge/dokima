/**
 * Pre-autorun cost estimate (BLUEPRINT §12.2, FR-G7): per-wave totals from
 * ticket points × the summed role-matrix rate, with historical per-ticket
 * actuals preferred over the matrix rate wherever they cover a wave's
 * tickets. Pure — no I/O, no event-log writes (same discipline as
 * `budget/breakers.ts`'s `readBreaker`) — so a caller (a future
 * Harbormaster pre-autorun check, or a hand-mirrored HTTP route until one
 * exists) gets a deterministic answer for the same inputs, which is what
 * makes the "what-if" recompute trustworthy (SRS FR-G7: "changing the
 * review role's model changes the estimate deterministically").
 */

import type {
  EstimateResult,
  HistoricalActual,
  RoleRate,
  TicketSizeInput,
  WaveEstimate,
} from './types.js';

function matrixUsdPerPoint(matrix: readonly RoleRate[]): number {
  return matrix.reduce((sum, rate) => sum + rate.usdPerPoint, 0);
}

/** Average $/point observed across every historical actual that names a ticket in this wave — undefined when none apply. */
function historicalUsdPerPoint(
  wave: readonly TicketSizeInput[],
  historicalActuals: readonly HistoricalActual[],
): number | undefined {
  const ticketIds = new Set(wave.map((t) => t.ticketId));
  const relevant = historicalActuals.filter((a) => ticketIds.has(a.ticketId));
  if (relevant.length === 0) return undefined;
  const totalPoints = relevant.reduce((sum, a) => sum + a.points, 0);
  if (totalPoints === 0) return undefined;
  const totalUsd = relevant.reduce((sum, a) => sum + a.actualUsd, 0);
  return totalUsd / totalPoints;
}

function groupByWave(
  tickets: readonly TicketSizeInput[],
): Map<number, TicketSizeInput[]> {
  const groups = new Map<number, TicketSizeInput[]>();
  for (const ticket of tickets) {
    const group = groups.get(ticket.wave);
    if (group) {
      group.push(ticket);
    } else {
      groups.set(ticket.wave, [ticket]);
    }
  }
  return groups;
}

/**
 * `points × Σ(role $/point)` per wave, preferring each wave's historical
 * $/point where any of its tickets have a recorded actual. Waves sort
 * ascending; empty `tickets` yields an empty result with an assumption
 * note rather than a divide-by-zero or a fabricated total (C-1).
 */
export function computeWaveEstimate(
  tickets: readonly TicketSizeInput[],
  matrix: readonly RoleRate[],
  historicalActuals: readonly HistoricalActual[] = [],
): EstimateResult {
  const assumptions: string[] = [];
  if (tickets.length === 0) {
    return { waves: [], totalUsd: 0, assumptions: ['no tickets to estimate'] };
  }
  const matrixRate = matrixUsdPerPoint(matrix);
  const usedHistorical = historicalActuals.length > 0;

  const waves = Array.from(groupByWave(tickets).entries())
    .sort(([a], [b]) => a - b)
    .map(([wave, waveTickets]): WaveEstimate => {
      const totalPoints = waveTickets.reduce((sum, t) => sum + t.points, 0);
      const historicalRate = historicalUsdPerPoint(waveTickets, historicalActuals);
      const usdPerPoint = historicalRate ?? matrixRate;
      return {
        wave,
        ticketCount: waveTickets.length,
        totalPoints,
        usdPerPoint,
        estimatedUsd: totalPoints * usdPerPoint,
        rateSource: historicalRate !== undefined ? 'historical' : 'matrix',
      };
    });

  if (!usedHistorical) {
    assumptions.push(
      'no historical actuals; every wave priced at matrix list-price only',
    );
  } else if (waves.some((w) => w.rateSource === 'matrix')) {
    assumptions.push(
      'some waves have no historical actuals for their tickets; those waves fall back to matrix list-price',
    );
  }

  return {
    waves,
    totalUsd: waves.reduce((sum, w) => sum + w.estimatedUsd, 0),
    assumptions,
  };
}

/** Deterministic what-if: merges `overrides` (role -> new $/point) onto `matrix` and recomputes — same tickets/actuals, only the rate changes (BLUEPRINT §12.2). */
export function applyRoleRateOverrides(
  matrix: readonly RoleRate[],
  overrides: Readonly<Record<string, number>>,
): RoleRate[] {
  return matrix.map((rate) =>
    rate.role in overrides
      ? { role: rate.role, usdPerPoint: overrides[rate.role] ?? rate.usdPerPoint }
      : rate,
  );
}
