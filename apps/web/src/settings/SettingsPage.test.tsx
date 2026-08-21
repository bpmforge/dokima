// @vitest-environment jsdom
/**
 * W12-31. The founder asked "is there a way to configure without running the
 * wizard". There always was — Settings is one header click away and the wizard
 * has a Cancel — but the surface did not read that way, and these fixtures
 * pin the two reasons it did not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsPage } from './SettingsPage.js';

afterEach(cleanup);

describe('SettingsPage without a project (W12-31)', () => {
  it(
    'RED FIXTURE: offers a way FORWARD, not just the wizard. This page was one ' +
      'sentence of internal vocabulary over a single Run Setup Wizard button, with ' +
      'no route to a project from here — so it read as "you must run the wizard"',
    () => {
      const onClose = vi.fn();
      render(<SettingsPage onOpenWizard={vi.fn()} onClose={onClose} />);

      const primary = screen.getByRole('button', { name: 'Choose a project' });
      expect(primary.className).toContain('btn-primary');
      fireEvent.click(primary);
      expect(onClose).toHaveBeenCalled();
    },
  );

  it('presents the wizard as ONE option rather than the only affordance', () => {
    render(<SettingsPage onOpenWizard={vi.fn()} onClose={vi.fn()} />);
    const wizard = screen.getByRole('button', { name: 'Run Setup Wizard' });
    // Present and reachable, but not the primary and not alone.
    expect(wizard.className).toContain('btn-secondary');
    expect(screen.getByText(/optional/)).toBeTruthy();
  });

  it(
    'explains WHY settings need a project instead of naming internals. The old ' +
      'copy said "model matrix, autonomy dial, budgets, and scopes" — four terms ' +
      'a first-time user has no way to interpret',
    () => {
      render(<SettingsPage onOpenWizard={vi.fn()} onClose={vi.fn()} />);
      expect(screen.getByText(/which providers it can reach/)).toBeTruthy();
      expect(screen.queryByText(/autonomy dial/)).toBeNull();
    },
  );
});

describe('SettingsPage with a project (W12-31)', () => {
  it(
    'RED FIXTURE: Providers is its own named tab. It was nested inside "Model ' +
      'Matrix", so someone looking for where to connect an account scanned ' +
      'fourteen labels, none of which said so, and concluded the wizard was the ' +
      'only way in',
    () => {
      render(<SettingsPage projectId="p1" onOpenWizard={vi.fn()} onClose={vi.fn()} />);
      const tabs = screen.getByLabelText('Settings sections');
      expect(tabs.textContent).toContain('Providers');
    },
  );

  it(
    'lists Providers FIRST so it is the first thing scanned, while still landing ' +
      'on Model Matrix — landing on Providers drops the model catalog, which ' +
      'lives in the matrix tab\'s own ProvidersPanel instance (W12-35)',
    () => {
      render(<SettingsPage projectId="p1" onOpenWizard={vi.fn()} onClose={vi.fn()} />);
      const labels = Array.from(
        screen.getByLabelText('Settings sections').querySelectorAll('button'),
      ).map((b) => b.textContent);
      expect(labels[0]).toContain('Providers');
    },
  );
});

describe('global inheritance is visible where a second project asks about it (W13-62)', () => {
  it("RED FIXTURE: says the wizard's providers and every-project defaults already apply to any new project — the novice must not fear a full re-setup per project", () => {
    render(<SettingsPage onOpenWizard={vi.fn()} onClose={vi.fn()} />);
    const lead = screen.getByText(/Settings belong to a project/);
    expect(lead.textContent).toContain('every-project model defaults');
    expect(lead.textContent).toContain('already apply to any project you create');
    expect(lead.textContent).toContain('nothing to set up again');
  });
});

describe('Basics up front, Advanced behind one disclosure (W19-05)', () => {
  it('RED FIXTURE: four basic tabs and the Advanced toggle greet the novice — the other ten do not render until asked. Sixteen flat tabs was the wall this replaces', () => {
    render(<SettingsPage projectId="p1" onOpenWizard={vi.fn()} onClose={vi.fn()} />);
    const nav = screen.getByLabelText('Settings sections');
    const labels = Array.from(nav.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual([
      'Providers',
      'Models',
      'Runs & Forge',
      'Autonomy · Budget · Berths',
      'Advanced ▸',
    ]);
  });

  it('the toggle reveals every advanced panel button — grouping only, nothing removed or renamed', () => {
    render(<SettingsPage projectId="p1" onOpenWizard={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('settings-advanced-toggle'));
    const nav = screen.getByLabelText('Settings sections');
    const labels = Array.from(nav.querySelectorAll('button')).map((b) => b.textContent);
    for (const label of [
      'Agent',
      'Cost Estimate',
      'Effective Settings',
      'MCP Servers',
      'Validator Packs',
      'Expert Overrides',
      'Rule Lifecycle',
      'Suppressions',
      'Escalation Policy',
      'Copilot',
    ]) {
      expect(labels).toContain(label);
    }
  });

  it('an ACTIVE advanced tab keeps the group open even after the toggle is clicked — the active tab can never vanish from its own nav', () => {
    render(<SettingsPage projectId="p1" onOpenWizard={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('settings-advanced-toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'Copilot' }));
    fireEvent.click(screen.getByTestId('settings-advanced-toggle'));
    expect(screen.getByRole('button', { name: 'Copilot' })).toBeTruthy();
  });
});
