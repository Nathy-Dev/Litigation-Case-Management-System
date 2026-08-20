import { Link } from 'react-router-dom';
import { Briefcase, Lock } from 'lucide-react';
import type { CaseRow } from '@/lib/selectors/cases';
import { formatDate, formatNairaCompact } from '@/lib/format';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';

/** Compact matter list for dashboards — the register itself uses DataTable. */
export function MattersPanel({
  rows,
  title,
  description,
  limit = 6,
  to = '/cases',
  linkLabel = 'Open register',
  showOwner = true,
  emptyMessage = 'No matters to show.',
}: {
  rows: CaseRow[];
  title: string;
  description?: string;
  limit?: number;
  to?: string;
  linkLabel?: string;
  showOwner?: boolean;
  emptyMessage?: string;
}) {
  return (
    <Card flush>
      <CardHeader
        title={title}
        description={description}
        icon={<Briefcase className="size-4" aria-hidden />}
        actions={
          <ButtonLink to={to} variant="ghost" size="sm">
            {linkLabel}
          </ButtonLink>
        }
        divided
      />
      {rows.length === 0 ? (
        <EmptyState compact title="Nothing here" description={emptyMessage} />
      ) : (
        <ul className="divide-y divide-ink-100">
          {rows.slice(0, limit).map((row) => (
            <li key={row.record.id}>
              <Link
                to={`/cases/${row.record.id}`}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ink-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-ink-500">{row.record.caseId}</span>
                    {row.record.confidential && (
                      <Lock className="size-3 text-gold-600" aria-label="Confidential" />
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] font-medium text-ink-900">
                    {row.record.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-500">
                    {row.courtName} ·{' '}
                    {row.nextHearing
                      ? `Next sitting ${formatDate(row.nextHearing.startsAt)}`
                      : 'No date fixed'}
                    {row.record.claimValue ? ` · ${formatNairaCompact(row.record.claimValue)}` : ''}
                  </span>
                </span>

                {showOwner && row.owner && <Avatar user={row.owner} size="xs" />}
                <StatusBadge status={row.record.status} size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
