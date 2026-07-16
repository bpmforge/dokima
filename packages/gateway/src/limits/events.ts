/**
 * Limit-pause events (FR-G8, ARCHITECTURE.md §8 "Provider limit window"): `limit.pause` and
 * `limit.resume` are always Record tier — a provider ceiling recovers on its own on a known
 * schedule, so it never raises a Decide-tier approval card the way `../budget/events.ts`'s
 * `budget.hard_stop` does at 100% spend (that's a *user* ceiling, requiring a human choice
 * between raising it or ending the run). `NotificationTier` here is a literal `'record'` type,
 * not the `'record' | 'decide'` union budget events use — a limit-pause event that claimed to be
 * Decide tier wouldn't typecheck, so "never Decide" is enforced at compile time, not by
 * convention. Mirrors `../budget/events.ts`'s injectable-sink pattern for the same reason: this
 * package cannot depend on `packages/events` from this ticket's write_scope
 * (`packages/gateway/src/limits/**`), so events are minted here and handed to a caller-supplied
 * sink wired to the real event log elsewhere (`packages/harbormaster/src/limit-pause*.ts`, this
 * ticket's harbormaster half, does that wiring against the real `@shipwright/events` log).
 */

export type LimitEventType = 'limit.pause' | 'limit.resume';

export type LimitNotificationTier = 'record';

/** How a pause's `resumeAt` was determined — a stated provider reset time, or this berth's own backoff fallback (FR-G8). */
export type LimitResumeSource = 'stated' | 'backoff';

export interface LimitPauseEvent {
  readonly type: 'limit.pause';
  readonly tier: LimitNotificationTier;
  readonly projectId: string;
  readonly runId: string;
  readonly berthId: string;
  readonly providerId: string;
  readonly pausedAt: string;
  readonly resumeAt: string;
  readonly resumeSource: LimitResumeSource;
  /** How many consecutive limit pauses this berth has hit without an intervening success — drives backoff, distinct from a budget breaker's monotonic spend ratio. */
  readonly attempt: number;
}

export interface LimitResumeEvent {
  readonly type: 'limit.resume';
  readonly tier: LimitNotificationTier;
  readonly projectId: string;
  readonly runId: string;
  readonly berthId: string;
  readonly providerId: string;
  readonly pausedAt: string;
  readonly resumedAt: string;
}

export type LimitEvent = LimitPauseEvent | LimitResumeEvent;

export interface LimitEventSink {
  emit(event: LimitEvent): void | Promise<void>;
}

export const noopLimitEventSink: LimitEventSink = {
  emit() {
    // Callers that don't need an audit trail (tests, exploratory scripts) opt out
    // explicitly by omitting a sink; production call sites must pass a real one
    // wired to packages/events.
  },
};

export function createInMemoryLimitEventSink(): LimitEventSink & {
  events: LimitEvent[];
} {
  const events: LimitEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}
