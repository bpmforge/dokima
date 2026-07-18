import { useState } from 'react';
import { readInjectedToken } from '../chat/api.js';
import { EstimateWorkspace } from '../estimate/EstimateWorkspace.js';
import { AutonomyBudgetPanel } from './AutonomyBudgetPanel.js';
import { CopilotConsentPanel } from './CopilotConsentPanel.js';
import { EffectiveSettingsPanel } from './EffectiveSettingsPanel.js';
import { EscalationPolicyPanel } from './EscalationPolicyPanel.js';
import { ExpertOverridesPanel } from './ExpertOverridesPanel.js';
import { McpServersPanel } from './McpServersPanel.js';
import { ModelMatrixPanel } from './ModelMatrixPanel.js';
import { RuleLifecyclePanel } from './RuleLifecyclePanel.js';
import { SuppressionsPanel } from './SuppressionsPanel.js';
import { ValidatorPacksPanel } from './ValidatorPacksPanel.js';
import './settings.css';

type Tab =
  | 'matrix'
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
  { id: 'matrix', label: 'Model Matrix' },
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

/** FR-S1 project-scope settings surface (W4-06): tabs over the model matrix, autonomy dial, budget panel, berths slider, effective-settings resolution view, MCP registration, validator packs, expert overrides, rule lifecycle, suppression review, escalation policy, and the D-019 Copilot consent gate. */
export function SettingsPage({ projectId, onOpenWizard, onClose }: SettingsPageProps) {
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
        <p className="settings__no-project">
          Open a project to configure its model matrix, autonomy dial, budgets, and
          scopes.
        </p>
        <button type="button" onClick={onOpenWizard}>
          Run Setup Wizard
        </button>
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
        {tab === 'matrix' && <ModelMatrixPanel projectId={projectId} />}
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
