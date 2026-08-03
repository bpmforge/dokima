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
  return (item.body as FreeformBody | null)?.diffStat ?? '';
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
          {new Date(item.createdAt).toLocaleString()}
        </time>
        {actions}
      </footer>
    </li>
  );
}
