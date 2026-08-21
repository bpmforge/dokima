import type { ReactNode } from 'react';
import type { NotificationItem } from './types.js';

const TIER_LABEL: Record<NotificationItem['tier'], string> = {
  decide: 'Decide',
  review: 'Review',
  record: 'Record',
};

const KIND_LABEL: Record<NotificationItem['kind'], string> = {
  clarification: 'Clarification',
  approval: 'Approval',
  blocked: 'Blocked',
  budget: 'Budget',
  pr_ready: 'PR ready',
  gate_passed: 'Gate passed',
  digest: 'Digest',
  drift_report: 'Drift report',
  suggestion: 'Suggestion',
};

interface DigestItem {
  kind?: string;
  title: string;
  summary?: string;
}

interface DigestBody {
  items?: DigestItem[];
}

interface SuggestionBody {
  message?: string;
}

interface FreeformBody {
  diffStat?: string;
}

/**
 * One-line summary (UX_SPEC §7 morning-queue card bullet). `body` is
 * freeform JSON per emitter (no receipts/cost producer is reachable from
 * apps/server yet, same gap `estimate-routes.ts` documents for the spend
 * ledger) — this renders whatever shape the known kinds actually produce
 * rather than inventing fields no emitter fills in.
 */
export function summaryLine(item: NotificationItem): string {
  if (item.kind === 'digest') {
    const body = item.body as DigestBody | null;
    const count = body?.items?.length ?? 0;
    return `${count} item${count === 1 ? '' : 's'} batched`;
  }
  if (item.kind === 'suggestion') {
    return (item.body as SuggestionBody | null)?.message ?? '';
  }
  const diffStat = (item.body as FreeformBody | null)?.diffStat;
  // W10-28: a bare `+120 -4` doesn't say what it counts — every other
  // summaryLine shape (digest, suggestion) already reads as a sentence.
  return diffStat ? `Diff: ${diffStat}` : '';
}

/**
 * Deliberately not the bare `toLocaleString()` default (verbose — includes
 * seconds no one reads — and inconsistent in shape across locales/browsers,
 * which read as an unstyled "raw" string rather than a designed one).
 * `dateStyle`/`timeStyle` still resolve through the runtime's locale (same
 * i18n behavior as before), just via a deliberately chosen, shorter format.
 */
export function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/**
 * W17-11: the C-4 same-model review refusal, explained where the person
 * meets it. A one-model install skips machine review CORRECTLY (the only
 * model would review its own work) — but a review-tier card carrying that
 * refusal read as a broken feature. Fired by the refusal's own marker
 * text, never a hardcoded ticket.
 */
const REVIEW_SKIP_MARKERS = ['never reviews its own work', 'same model as maker'];

export function reviewSkipExplainer(item: NotificationItem): string | null {
  const text = [
    item.title,
    summaryLine(item),
    ...(item.kind === 'digest'
      ? ((item.body as DigestBody | null)?.items ?? []).map(
          (d) => `${d.title} ${d.summary ?? ''}`,
        )
      : []),
  ].join(' ');
  if (!REVIEW_SKIP_MARKERS.some((marker) => text.includes(marker))) return null;
  return (
    'Machine review was skipped because the only configured model would be ' +
    'reviewing its own work — that is the guarantee working, not a fault. ' +
    'Add a second model for the code-reviewer role under Settings → Models ' +
    'to enable machine review; until then, reviews land here for you.'
  );
}

export interface NotificationCardProps {
  item: NotificationItem;
  actions?: ReactNode;
}

export function NotificationCard({ item, actions }: NotificationCardProps) {
  const summary = summaryLine(item);
  const digestItems =
    item.kind === 'digest' ? (item.body as DigestBody | null)?.items : undefined;
  return (
    <li className="notification-card" data-testid={`notification-${item.id}`}>
      <header className="notification-card__header">
        <span className={`notification-card__tier notification-card__tier--${item.tier}`}>
          {TIER_LABEL[item.tier]}
        </span>
        <span className="notification-card__kind">{KIND_LABEL[item.kind]}</span>
        <span className="notification-card__project">{item.projectName}</span>
      </header>
      <p className="notification-card__title">{item.title}</p>
      {summary && <p className="notification-card__summary">{summary}</p>}
      {(() => {
        const why = reviewSkipExplainer(item);
        return why ? (
          <p
            className="notification-card__consequence"
            data-testid={`review-skip-why-${item.id}`}
          >
            {why}
          </p>
        ) : null;
      })()}
      {digestItems && digestItems.length > 0 && (
        <ul
          className="notification-card__digest-items"
          data-testid={`notification-${item.id}-digest-items`}
        >
          {digestItems.map((digestItem, index) => (
            <li key={index}>
              <strong>{digestItem.title}</strong>
              {digestItem.summary && <span> — {digestItem.summary}</span>}
            </li>
          ))}
        </ul>
      )}
      <footer className="notification-card__footer">
        <time className="notification-card__time" dateTime={item.createdAt}>
          {formatTimestamp(item.createdAt)}
        </time>
        {actions}
      </footer>
    </li>
  );
}
