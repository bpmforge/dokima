import { useState } from 'react';
import { readInjectedToken } from '../chat/api.js';
import { EstimateWorkspace } from '../estimate/EstimateWorkspace.js';
import { AgentRunnerPanel } from './AgentRunnerPanel.js';
import { AutonomyBudgetPanel } from './AutonomyBudgetPanel.js';
import { CopilotConsentPanel } from './CopilotConsentPanel.js';
import { EffectiveSettingsPanel } from './EffectiveSettingsPanel.js';
import { EscalationPolicyPanel } from './EscalationPolicyPanel.js';
import { ExpertOverridesPanel } from './ExpertOverridesPanel.js';
import { McpServersPanel } from './McpServersPanel.js';
import { ModelMatrixPanel } from './ModelMatrixPanel.js';
import { ProvidersPanel } from './ProvidersPanel.js';
import { RuleLifecyclePanel } from './RuleLifecyclePanel.js';
import { SuppressionsPanel } from './SuppressionsPanel.js';
import { ValidatorPacksPanel } from './ValidatorPacksPanel.js';
import './settings.css';

type Tab =
  | 'providers'
  | 'matrix'
  | 'agent'
  | 'autonomy-budget'
  | 'estimate'
  | 'effective'
  | 'mcp'
  | 'validators'
  | 'experts'
  | 'rules'
  | 'suppressions'
  | 'escalation'
  | 'copilot';

const PROJECT_TABS: { id: Tab; label: string }[] = [
  // W12-31: Providers is FIRST and named. It was nested inside "Model Matrix"
  // — a user looking for where to connect an account scanned a list of
  // fourteen labels, none of which said so, and reasonably concluded the
  // setup wizard was the only way in. `ModelMatrixPanel` still composes the
  // same panel for its model catalog; this is about the nav, not the code.
  { id: 'providers', label: 'Providers' },
  { id: 'matrix', label: 'Model Matrix' },
  { id: 'agent', label: 'Agent' },
  { id: 'autonomy-budget', label: 'Autonomy · Budget · Berths' },
  { id: 'estimate', label: 'Cost Estimate' },
  { id: 'effective', label: 'Effective Settings' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'validators', label: 'Validator Packs' },
  { id: 'experts', label: 'Expert Overrides' },
  { id: 'rules', label: 'Rule Lifecycle' },
  { id: 'suppressions', label: 'Suppressions' },
  { id: 'escalation', label: 'Escalation Policy' },
  { id: 'copilot', label: 'Copilot' },
];

export interface SettingsPageProps {
  projectId?: string;
  onOpenWizard: () => void;
  onClose: () => void;
}

/** FR-S1 project-scope settings surface (W4-06): tabs over the model matrix, agent runner picker (D-023), autonomy dial, budget panel, berths slider, effective-settings resolution view, MCP registration, validator packs, expert overrides, rule lifecycle, suppression review, escalation policy, and the D-019 Copilot consent gate. */
export function SettingsPage({ projectId, onOpenWizard, onClose }: SettingsPageProps) {
  /**
   * Lands on Model Matrix, NOT on the new Providers tab, and that is a
   * deliberate retreat rather than an oversight. Defaulting to Providers broke
   * four e2e flows, because `ModelMatrixPanel` composes its OWN
   * `ProvidersPanel` and the discovered model catalog lives in that instance's
   * memory — landing elsewhere and switching tabs drops it, so the matrix's
   * Model picker arrives empty. The duplicate mount is the real defect
   * (W12-35); until it is lifted, changing the landing tab would trade a
   * discoverability win for a broken picker. Providers being NAMED in the nav
   * is what this ticket was actually for, and that part stands.
   */
  const [tab, setTab] = useState<Tab>('matrix');
  const token = readInjectedToken();

  if (!projectId) {
    return (
      <div className="settings" data-testid="settings-page">
        <header className="settings__header">
          <h1>Settings</h1>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        {/* W12-31: this page used to be one sentence of internal vocabulary
            ("model matrix, autonomy dial, budgets, and scopes") over a single
            Run Setup Wizard button, with no way to reach a project from here.
            It read as "you must run the wizard", which is what prompted the
            question. Settings are per-project because providers, budgets and
            policies belong to a project — so say that, and lead somewhere. */}
        <div className="empty-state">
          <p className="empty-state__lead">
            Settings belong to a project — which models it uses, which providers
            it can reach, and what it is allowed to spend. Pick a project and
            they will be here.
          </p>
          <div className="empty-state__actions">
            <button type="button" className="btn-primary" onClick={onClose}>
              Choose a project
            </button>
            <button type="button" className="btn-secondary" onClick={onOpenWizard}>
              Run Setup Wizard
            </button>
          </div>
          <p className="settings__no-project">
            The wizard is a guided first run — it is optional, and everything it
            sets can be changed here afterwards.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings" data-testid="settings-page">
      <header className="settings__header">
        <h1>Settings</h1>
        <div className="settings__header-actions">
          <button type="button" onClick={onOpenWizard}>
            Setup Wizard
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </header>
      <nav className="settings__tabs" aria-label="Settings sections">
        {PROJECT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={
              t.id === tab ? 'settings__tab settings__tab--active' : 'settings__tab'
            }
            aria-current={t.id === tab ? 'true' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="settings__panel">
        {tab === 'providers' && <ProvidersPanel projectId={projectId} />}
        {tab === 'matrix' && <ModelMatrixPanel projectId={projectId} />}
        {tab === 'agent' && <AgentRunnerPanel projectId={projectId} />}
        {tab === 'autonomy-budget' && <AutonomyBudgetPanel projectId={projectId} />}
        {tab === 'estimate' && token && (
          <EstimateWorkspace token={token} projectId={projectId} />
        )}
        {tab === 'effective' && <EffectiveSettingsPanel projectId={projectId} />}
        {tab === 'mcp' && <McpServersPanel projectId={projectId} />}
        {tab === 'validators' && <ValidatorPacksPanel projectId={projectId} />}
        {tab === 'experts' && <ExpertOverridesPanel projectId={projectId} />}
        {tab === 'rules' && <RuleLifecyclePanel projectId={projectId} />}
        {tab === 'suppressions' && <SuppressionsPanel projectId={projectId} />}
        {tab === 'escalation' && <EscalationPolicyPanel projectId={projectId} />}
        {tab === 'copilot' && <CopilotConsentPanel projectId={projectId} />}
      </div>
    </div>
  );
}
