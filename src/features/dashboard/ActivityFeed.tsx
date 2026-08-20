import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRightLeft,
  FileCheck2,
  FilePlus2,
  Gavel,
  ListChecks,
  Lock,
  MessageSquare,
  Scale,
  UserPlus,
} from 'lucide-react';
import type { TimelineEvent, TimelineEventType } from '@/types';
import { formatRelative } from '@/lib/format';
import { useDataStore } from '@/store/dataStore';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';

export const EVENT_ICON: Record<TimelineEventType, typeof Scale> = {
  'case.created': Scale,
  'case.updated': ArrowRightLeft,
  'case.status.changed': ArrowRightLeft,
  'case.archived': Lock,
  'document.uploaded': FilePlus2,
  'document.version.added': FileCheck2,
  'document.checked_out': Lock,
  'document.checked_in': FileCheck2,
  'courtdate.created': Gavel,
  'courtdate.updated': Gavel,
  'courtdate.outcome.recorded': Gavel,
  'task.created': ListChecks,
  'task.completed': ListChecks,
  'note.added': MessageSquare,
  'counsel.assigned': UserPlus,
};

/** Chronological feed shared by the dashboard and the case timeline tab. */
export function ActivityFeed({
  events,
  title = 'Recent activity',
  description = 'The latest movements across matters you can see.',
  limit = 10,
  showCase = true,
  flush = true,
}: {
  events: TimelineEvent[];
  title?: string;
  description?: string;
  limit?: number;
  showCase?: boolean;
  flush?: boolean;
}) {
  const users = useDataStore((state) => state.users);
  const cases = useDataStore((state) => state.cases);

  const body =
    events.length === 0 ? (
      <EmptyState
        compact
        icon={<Activity className="size-5" aria-hidden />}
        title="No activity yet"
        description="Actions on matters will appear here as they happen."
      />
    ) : (
      <ol className="relative px-4 py-3 sm:px-5">
        <span className="absolute top-5 bottom-5 left-[1.85rem] w-px bg-ink-150 sm:left-[2.1rem]" aria-hidden />
        {events.slice(0, limit).map((event) => {
          const actor = users.find((item) => item.id === event.actorId);
          const matter = cases.find((item) => item.id === event.caseId);
          const Icon = EVENT_ICON[event.type] ?? Activity;

          return (
            <li key={event.id} className="relative flex gap-3 py-2.5">
              <span className="z-10 mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-white ring-1 ring-ink-200">
                <Icon className="size-3.5 text-brand-600" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug text-ink-800">
                  <span className="font-medium text-ink-900">{actor?.fullName ?? 'System'}</span>{' '}
                  {event.summary}
                </p>
                {event.detail && (
                  <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-500">{event.detail}</p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-400">
                  <span>{formatRelative(event.at)}</span>
                  {showCase && matter && (
                    <>
                      <span aria-hidden>·</span>
                      <Link
                        to={`/cases/${matter.id}`}
                        className="font-mono text-brand-700 hover:underline"
                      >
                        {matter.caseId}
                      </Link>
                    </>
                  )}
                </p>
              </div>
              {actor && <Avatar user={actor} size="xs" className="mt-1 hidden sm:block" />}
            </li>
          );
        })}
      </ol>
    );

  if (!flush) return body;

  return (
    <Card flush>
      <CardHeader
        title={title}
        description={description}
        icon={<Activity className="size-4" aria-hidden />}
        divided
      />
      {body}
    </Card>
  );
}
