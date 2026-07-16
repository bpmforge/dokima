import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAgentHistory, fetchRoster, RosterApiError } from './api.js';
import type { AgentHistory, RosterExpert } from './types.js';
import './roster.css';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof RosterApiError ? err.message : fallback;
}

function scopeLabel(scope: RosterExpert['effectiveModel']['scope']): string {
  return scope === null ? 'unconfigured' : scope;
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
  return (
    <li className="roster__expert" data-testid={`roster-expert-${expert.id}`}>
      <button type="button" className="roster__expert-summary" onClick={onToggle}>
        <span className="roster__expert-name">{expert.displayName}</span>
        <span className="roster__expert-mode">{expert.mode}</span>
        <span
          className="roster__expert-scope"
          data-testid={`roster-expert-scope-${expert.id}`}
        >
          {scopeLabel(expert.effectiveModel.scope)}
        </span>
      </button>
      <p className="roster__expert-description">{expert.description}</p>
      <div className="roster__expert-model">
        {expert.effectiveModel.chain.length > 0 ? (
          <span>{expert.effectiveModel.chain.join(' → ')}</span>
        ) : (
          <span className="roster__unconfigured">
            unconfigured — no routing matrix entry
          </span>
        )}
      </div>
      <div className="roster__expert-fitness">
        {expert.fitnessCards.length > 0 ? (
          expert.fitnessCards.map((card) => (
            <span
              key={card.model}
              className={`roster__fitness-badge roster__fitness-badge--${card.verdict}`}
            >
              {card.model}: {card.verdict}
            </span>
          ))
        ) : (
          <span className="roster__unconfigured">not benched</span>
        )}
      </div>
      <div className="roster__expert-instruction-cost">
        instruction cost: {expert.instructionCost === null ? '—' : expert.instructionCost}
      </div>
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
