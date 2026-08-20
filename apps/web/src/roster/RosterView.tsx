import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAgentHistory, fetchRoster, RosterApiError } from './api.js';
import type { AgentHistory, RosterExpert } from './types.js';
import './roster.css';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof RosterApiError ? err.message : fallback;
}

/**
 * The one line a user reads about an expert (W13-49, UX_AUDIT A-1).
 *
 * The stored `description` is the expert's internal brief — written FOR the
 * model ("checks all 31 ANTI_SLOP_RULES (R-01 to R-31)…"). Shown raw, the
 * roster read as a debug dump. This derives the user's line mechanically —
 * the clause before the first em-dash, first sentence as fallback, capped —
 * rather than hand-writing summaries that would drift from the briefs they
 * summarize.
 */
export function userFacingSummary(description: string): string {
  const beforeDash = description.split(/\s+—\s+/)[0] ?? description;
  const firstSentence = beforeDash.split(/(?<=\.)\s/)[0] ?? beforeDash;
  const line = firstSentence.trim().replace(/\.$/, '');
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}

/**
 * The scope chip appears only when it says something a user can act on or
 * should notice: a missing model (actionable) or an override (surprising).
 * The global default is the norm, and the norm is silence — the old chip
 * said "unconfigured" on every card of a working install, which reads as
 * "your product is broken" (A-1).
 */
function scopeChip(expert: RosterExpert): string | null {
  if (expert.effectiveModel.chain.length === 0) return 'needs a model';
  const scope = expert.effectiveModel.scope;
  return scope === 'project' || scope === 'run' ? `${scope} override` : null;
}

function groupByCluster(experts: RosterExpert[]): Map<string, RosterExpert[]> {
  const groups = new Map<string, RosterExpert[]>();
  for (const expert of experts) {
    const list = groups.get(expert.cluster) ?? [];
    list.push(expert);
    groups.set(expert.cluster, list);
  }
  return groups;
}

interface AgentHistoryPanelProps {
  agentId: string;
  projectId: string;
}

function AgentHistoryPanel({ agentId, projectId }: AgentHistoryPanelProps) {
  const [history, setHistory] = useState<AgentHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setError(null);
    fetchAgentHistory(agentId, projectId)
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err, 'Failed to load history'));
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, projectId]);

  if (error) {
    return (
      <p className="roster__error" role="alert">
        {error}
      </p>
    );
  }
  if (!history) {
    return <p className="roster__history-loading">Loading history…</p>;
  }

  return (
    <dl className="roster__history-stats" data-testid={`roster-history-${agentId}`}>
      <div>
        <dt>HANDOFFs run</dt>
        <dd>{history.handoffsRun}</dd>
      </div>
      <div>
        <dt>Outcomes</dt>
        <dd>{history.outcomes}</dd>
      </div>
      <div>
        <dt>Verdict scores</dt>
        <dd>{history.verdictScores}</dd>
      </div>
      <div>
        <dt>Spend events</dt>
        <dd>{history.spend}</dd>
      </div>
      <div>
        <dt>Escalations</dt>
        <dd>{history.escalations}</dd>
      </div>
    </dl>
  );
}

interface ExpertRowProps {
  expert: RosterExpert;
  projectId: string | null;
  expanded: boolean;
  onToggle: () => void;
}

function ExpertRow({ expert, projectId, expanded, onToggle }: ExpertRowProps) {
  const chip = scopeChip(expert);
  return (
    <li className="roster__expert" data-testid={`roster-expert-${expert.id}`}>
      <button type="button" className="roster__expert-summary" onClick={onToggle}>
        <span className="roster__expert-name">{expert.displayName}</span>
        <span className="roster__expert-mode">{expert.mode}</span>
        {chip !== null && (
          <span
            className="roster__expert-scope"
            data-testid={`roster-expert-scope-${expert.id}`}
          >
            {chip}
          </span>
        )}
      </button>
      <p className="roster__expert-description">{userFacingSummary(expert.description)}</p>
      {/* W13-49: each line below renders ONLY when it informs or asks for an
          action. The old row stacked three failure-toned lines on every card
          of a healthy install — "unconfigured — no routing matrix entry",
          "not benched", "instruction cost: —" — builder diagnostics shipped
          to the user (UX_AUDIT A-1). */}
      {expert.effectiveModel.chain.length > 0 ? (
        <div className="roster__expert-model">
          <span>{expert.effectiveModel.chain.join(' → ')}</span>
        </div>
      ) : (
        <div className="roster__expert-model">
          <span className="roster__unconfigured">
            No model will take this role yet — pick models in Settings → Models.
          </span>
        </div>
      )}
      {expert.fitnessCards.length > 0 && (
        <div className="roster__expert-fitness">
          {expert.fitnessCards.map((card) => (
            <span
              key={card.model}
              className={`roster__fitness-badge roster__fitness-badge--${card.verdict}`}
            >
              {card.model}: {card.verdict}
            </span>
          ))}
        </div>
      )}
      {expert.instructionCost !== null && (
        <div className="roster__expert-instruction-cost">
          instruction cost: {expert.instructionCost}
        </div>
      )}
      {expanded && projectId && (
        <AgentHistoryPanel agentId={expert.id} projectId={projectId} />
      )}
      {expanded && !projectId && (
        <p className="roster__history-loading">
          Open a project to see per-agent history.
        </p>
      )}
    </li>
  );
}

export interface RosterViewProps {
  /** Layers in project-scope matrix overrides + enables per-agent history; omit for the global-only view. */
  projectId?: string | null;
}

export function RosterView({ projectId = null }: RosterViewProps) {
  const [experts, setExperts] = useState<RosterExpert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchRoster({ projectId: projectId ?? undefined });
      setExperts(list);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load roster'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grouped = useMemo(() => groupByCluster(experts), [experts]);

  return (
    <div className="roster" data-testid="roster-view">
      <header className="roster__header">
        <h1>Agent Roster</h1>
      </header>

      {error && (
        <p className="roster__error" role="alert">
          {error}
        </p>
      )}

      {!loading && experts.length === 0 && !error ? (
        <p className="roster__empty">No experts found.</p>
      ) : (
        Array.from(grouped.entries()).map(([cluster, clusterExperts]) => (
          <section
            key={cluster}
            className="roster__cluster"
            data-testid={`roster-cluster-${cluster}`}
          >
            <h2>{cluster}</h2>
            <ul className="roster__expert-list">
              {clusterExperts.map((expert) => (
                <ExpertRow
                  key={expert.id}
                  expert={expert}
                  projectId={projectId}
                  expanded={expandedId === expert.id}
                  onToggle={() =>
                    setExpandedId((prev) => (prev === expert.id ? null : expert.id))
                  }
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
