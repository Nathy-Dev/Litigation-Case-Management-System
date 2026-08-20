import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import type { User } from '@/types';
import { cn } from '@/lib/utils';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ButtonLink } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';

export interface WorkloadEntry {
  user: User;
  open: number;
  hearings: number;
  overdue: number;
}

/**
 * Workload by lawyer (TOR §18) shown as a bar-in-row table so the comparison
 * reads at a glance without a chart library on the critical path.
 */
export function WorkloadPanel({
  workload,
  limit = 6,
}: {
  workload: WorkloadEntry[];
  limit?: number;
}) {
  const shown = workload.filter((entry) => entry.open > 0).slice(0, limit);
  const busiest = Math.max(1, ...shown.map((entry) => entry.open));

  return (
    <Card flush>
      <CardHeader
        title="Workload by lawyer"
        hint="Open matters, sittings in the next 30 days and overdue tasks."
        icon={<Users className="size-4" aria-hidden />}
        actions={
          <ButtonLink to="/reports?report=workload-by-lawyer" variant="ghost" size="sm">
            Full report
          </ButtonLink>
        }
        divided
      />
      {shown.length === 0 ? (
        <EmptyState compact title="No allocations" description="No matters are assigned yet." />
      ) : (
        <ul className="divide-y divide-ink-100">
          {shown.map((entry) => (
            <li key={entry.user.id} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar user={entry.user} size="sm" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink-900">
                  {entry.user.fullName}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <div
                    className="h-1.5 w-full max-w-[10rem] overflow-hidden rounded-full bg-ink-150"
                    role="img"
                    aria-label={`${entry.open} open matters`}
                  >
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${Math.round((entry.open / busiest) * 100)}%` }}
                    />
                  </div>
                  <span className="tnum text-[11px] text-ink-500">
                    {entry.hearings} sitting{entry.hearings === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3 text-right">
                <span className="tnum text-[15px] font-semibold text-ink-900">{entry.open}</span>
                <Link
                  to={`/tasks?owner=${entry.user.id}`}
                  className={cn(
                    'tnum rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                    entry.overdue > 0
                      ? 'bg-danger-50 text-danger-700 hover:bg-danger-100'
                      : 'text-ink-400',
                  )}
                  title={`${entry.overdue} overdue task${entry.overdue === 1 ? '' : 's'}`}
                >
                  {entry.overdue} late
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
