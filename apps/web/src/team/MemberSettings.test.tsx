// @vitest-environment jsdom
/**
 * W20-06 (D-029): per-member settings, and the ask-mode copy that has to be
 * exactly right — because the whole point of `ask` is that it does NOT stop
 * the work while it waits.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemberSettings, type MemberSettingsValue } from './MemberSettings.js';

afterEach(cleanup);

const BASE: MemberSettingsValue = { escalation: 'ladder' };

function panel(value = BASE, onSave = vi.fn()) {
  render(<MemberSettings displayName="Sam" value={value} onSave={onSave} />);
  return onSave;
}

describe('MemberSettings (W20-06)', () => {
  it("RED FIXTURE: ask mode says it does NOT pause the work — a founder reading 'ask me first' must not fear a stalled overnight run (D-029)", () => {
    panel();
    const askCopy = screen.getByText(/Keeps working on the current model/);
    expect(askCopy.textContent).toContain('asks you before climbing');
    expect(askCopy.textContent).toContain('Nothing pauses while it waits');
  });

  it('saves this member only, and says so — a per-member knob that silently changed everyone would be worse than none', () => {
    const onSave = panel();
    fireEvent.click(screen.getByTestId('escalation-ask'));
    fireEvent.change(screen.getByTestId('member-turns'), { target: { value: '20' } });
    fireEvent.click(screen.getByTestId('member-settings-save'));
    expect(onSave).toHaveBeenCalledWith({ escalation: 'ask', maxToolIterations: 20 });
    expect(screen.getByTestId('member-settings-saved').textContent).toContain(
      'everyone else keeps what they had',
    );
  });

  it('an empty turn budget saves no override rather than writing a zero', () => {
    const onSave = panel();
    fireEvent.click(screen.getByTestId('member-settings-save'));
    expect(onSave).toHaveBeenCalledWith({ escalation: 'ladder' });
  });

  it('the unset turn budget shows the default it actually runs at', () => {
    panel();
    expect(
      (screen.getByTestId('member-turns') as HTMLInputElement).placeholder,
    ).toContain('12');
  });

  it('all three modes describe their consequence, not just their name', () => {
    panel();
    expect(screen.getByText(/cheapest model first/)).toBeTruthy();
    expect(screen.getByText(/parks with its evidence/)).toBeTruthy();
  });
});
