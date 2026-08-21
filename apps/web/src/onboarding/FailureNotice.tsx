/**
 * W16-06: the one way an interview-surface failure renders. Plain-language
 * summary as the alert line; the raw technical string kept — "shown, not
 * swallowed" — but demoted into a closed disclosure so it can never again be
 * the first thing a novice reads.
 */
import type { FriendlyFailure } from './friendly-error.js';

export interface FailureNoticeProps {
  readonly failure: FriendlyFailure;
  /** The testid the surface already used for its error line, kept stable. */
  readonly testId: string;
}

export function FailureNotice({
  failure,
  testId,
}: FailureNoticeProps): React.JSX.Element {
  return (
    <div className="interview__failure">
      <p className="interview__error" role="alert" data-testid={testId}>
        {failure.summary}
      </p>
      <details className="interview__failure-detail" data-testid={`${testId}-detail`}>
        <summary>Technical detail</summary>
        <code>{failure.detail}</code>
      </details>
    </div>
  );
}
