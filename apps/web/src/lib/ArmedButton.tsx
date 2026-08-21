import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Two-click confirmation that never leaves the page (W18-01). The first
 * click arms the button — the label flips to the consequence — and only a
 * second click inside the armed window executes. Anything else (timeout,
 * blur) disarms back to the resting label.
 *
 * This replaces `window.confirm`: a native dialog blocks the whole tab's
 * event loop (the live design pass froze the canvas behind one), cannot be
 * styled, and cannot be exercised by tests or automation. The armed state
 * is plain DOM, so all three problems go away and the consequence copy is
 * rendered where the reader already is.
 */
export interface ArmedButtonProps {
  /** Resting label — the action's name. */
  readonly label: string;
  /** Armed label — the consequence plus the ask to click again. */
  readonly armedLabel: string;
  /** Longer consequence copy rendered beside the armed button, if any. */
  readonly armedDetail?: string;
  readonly onConfirm: () => void | Promise<void>;
  readonly className?: string;
  readonly title?: string;
  readonly testId?: string;
  /** How long the armed state lasts before it disarms itself. */
  readonly disarmAfterMs?: number;
}

export function ArmedButton({
  label,
  armedLabel,
  armedDetail,
  onConfirm,
  className,
  title,
  testId,
  disarmAfterMs = 6000,
}: ArmedButtonProps) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setArmed(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const handleClick = useCallback(() => {
    if (!armed) {
      setArmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), disarmAfterMs);
      return;
    }
    disarm();
    void onConfirm();
  }, [armed, disarm, disarmAfterMs, onConfirm]);

  return (
    <>
      <button
        type="button"
        className={className}
        title={title}
        data-testid={testId}
        data-armed={armed || undefined}
        aria-live="polite"
        onClick={handleClick}
        onBlur={disarm}
      >
        {armed ? armedLabel : label}
      </button>
      {armed && armedDetail && (
        <span className="settings__hint" role="status">
          {armedDetail}
        </span>
      )}
    </>
  );
}
