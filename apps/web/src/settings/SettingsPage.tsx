import { useState } from 'react';
import { readInjectedToken } from '../chat/api.js';
import { EstimateWorkspace } from '../estimate/EstimateWorkspace.js';
import { AgentRunnerPanel } from './AgentRunnerPanel.js';
import { RunKnobsPanel } from './RunKnobsPanel.js';
import { AutonomyBudgetPanel } from './AutonomyBudgetPanel.js';
import { CopilotConsentPanel } from './CopilotConsentPanel.js';
import { EffectiveSettingsPanel } from './EffectiveSettingsPanel.js';
import { EscalationPolicyPanel } from './EscalationPolicyPanel.js';
import { ExpertOverridesPanel } from './ExpertOverridesPanel.js';
import { McpServersPanel } from './McpServersPanel.js';
import { ModelMatrixPanel } from './ModelMatrixPanel.js';
import { ProvidersPanel } from './ProvidersPanel.js';
import type { ProviderCatalog, ProviderEntry } from './providers-api.js';
import { RuleLifecyclePanel } from './RuleLifecyclePanel.js';
import { SuppressionsPanel } from './SuppressionsPanel.js';
import { ValidatorPacksPanel } from './ValidatorPacksPanel.js';
import './settings.css';

type Tab =
  | 'providers'
  | 'matrix'
  | 'agent'
  | 'runs'
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

/** W19-05: the four tabs a novice actually needs greet them; the other ten
 * live behind one Advanced disclosure. Grouping only — every panel keeps its
 * id, label, and mount; opening a tab that lives in the advanced group (e.g.
 * programmatically) auto-expands the group so nothing is ever unreachable. */
const BASIC_TAB_IDS: readonly Tab[] = ['providers', 'matrix', 'runs', 'autonomy-budget'];

const PROJECT_TABS: { id: Tab; label: string }[] = [
  // W12-31: Providers is FIRST and named. It was nested inside "Model Matrix"
  // — a user looking for where to connect an account scanned a list of
  // fourteen labels, none of which said so, and reasonably concluded the
  // setup wizard was the only way in. `ModelMatrixPanel` still composes the
  // same panel for its model catalog; this is about the nav, not the code.
  { id: 'providers', label: 'Providers' },
  // W13-51: the LABEL is 'Models' per VOCABULARY.md ('the setting is called
  // what it does'); the id and every wire shape stay 'matrix' — rename in the
  // UI only. Our own W13-34 error copy said 'Open Settings → Models' while
  // this row said 'Model Matrix': the product contradicted its own
  // instruction, and validate-ui-copy now gates that class.
  { id: 'matrix', label: 'Models' },
  { id: 'agent', label: 'Agent' },
  // W17-08: the knobs the live UAT proved matter, promoted from raw keys.
  { id: 'runs', label: 'Runs & Forge' },
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
  /**
   * W12-35: Settings owns the provider catalog so ONE `ProvidersPanel` serves
   * both tabs. It used to be state inside `ModelMatrixPanel`, which mounted
   * its own panel — so once Providers became its own tab there were two
   * instances and the catalog lived in whichever did the discovering.
   */
  const [catalogs, setCatalogs] = useState<Record<string, ProviderCatalog>>({});
  const [providerEntries, setProviderEntries] = useState<ProviderEntry[]>([]);
  // W12-31 deliberately landed on Model Matrix because the picker arrived
  // empty otherwise. With the catalog lifted, that reason is gone: Settings
  // opens where people actually come to it.
  const [tab, setTab] = useState<Tab>('providers');
  // W19-05: sticky once opened this visit; an advanced ACTIVE tab keeps it open.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const showAdvanced = advancedOpen || !BASIC_TAB_IDS.includes(tab);
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
            they will be here. The providers and every-project model defaults
            you registered in the wizard already apply to any project you
            create — a new project starts from them, so there is nothing to
            set up again.
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
    <div className="page settings" data-testid="settings-page">
      <div className="page__inner">
      <header className="page__header settings__header">
        <h1 className="page__title">Settings</h1>
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
        {PROJECT_TABS.filter((t) => BASIC_TAB_IDS.includes(t.id)).map((t) => (
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
        <button
          type="button"
          className="settings__tab settings__tab--advanced-toggle"
          data-testid="settings-advanced-toggle"
          aria-expanded={showAdvanced}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {showAdvanced ? 'Advanced ▾' : 'Advanced ▸'}
        </button>
        {showAdvanced &&
          PROJECT_TABS.filter((t) => !BASIC_TAB_IDS.includes(t.id)).map((t) => (
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
        {/* Mounted once, always — `hidden` rather than unmounted, so the
            catalog it discovered survives a tab switch instead of being
            re-fetched (or lost) each time. */}
        <div hidden={tab !== 'providers'}>
          <ProvidersPanel
            projectId={projectId}
            onCatalogsChange={setCatalogs}
            onEntriesChange={setProviderEntries}
          />
        </div>
        {tab === 'matrix' && (
          <ModelMatrixPanel
            projectId={projectId}
            catalogs={catalogs}
            providerEntries={providerEntries}
          />
        )}
        {tab === 'agent' && <AgentRunnerPanel projectId={projectId} />}
        {tab === 'runs' && <RunKnobsPanel projectId={projectId} />}
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
    </div>
  );
}
