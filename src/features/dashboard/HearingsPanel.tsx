import { Link } from 'react-router-dom';
import { CalendarClock, Gavel, MapPin } from 'lucide-react';
import type { CourtDate } from '@/types';
import { formatHearingSlot, daysUntil, shortCourtName } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';

function dayLabel(startsAt: string) {
  const days = daysUntil(startsAt);
  if (days < 0) return { text: 'Past', tone: 'neutral' as const };
  if (days === 0) return { text: 'Today', tone: 'danger' as const };
  if (days === 1) return { text: 'Tomorrow', tone: 'gold' as const };
  if (days <= 7) return { text: `In ${days} days`, tone: 'brand' as const };
  return { text: `In ${days} days`, tone: 'neutral' as const };
}

/** The hearing diary strip used on every dashboard (TOR §§10–13). */
export function HearingsPanel({
  hearings,
  title = 'Court diary',
  description,
  limit = 6,
}: {
  hearings: CourtDate[];
  title?: string;
  description?: string;
  limit?: number;
}) {
  const cases = useDataStore((state) => state.cases);
  const courts = useDataStore((state) => state.courts);

  return (
    <Card flush>
      <CardHeader
        title={title}
        description={description ?? 'Next sittings, soonest first.'}
        icon={<CalendarClock className="size-4" aria-hidden />}
        actions={
          <ButtonLink to="/calendar" variant="ghost" size="sm">
            Open calendar
          </ButtonLink>
        }
        divided
      />
        {hearings.length === 0 ? (
          <EmptyState
            compact
            icon={<Gavel className="size-5" aria-hidden />}
            title="No sittings scheduled"
            description="Nothing is listed for the period ahead."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {hearings.slice(0, limit).map((sitting) => {
              const matter = cases.find((item) => item.id === sitting.caseId);
              const court = courts.find((item) => item.id === sitting.courtId);
              const label = dayLabel(sitting.startsAt);

              return (
                <li key={sitting.id}>
                  <Link
                    to={`/cases/${sitting.caseId}?tab=court-dates`}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-ink-50"
                  >
                    <span
                      className={cn(
                        'mt-0.5 grid w-11 shrink-0 place-items-center rounded-lg py-1',
                        label.tone === 'danger'
                          ? 'bg-danger-50 text-danger-700'
                          : label.tone === 'gold'
                            ? 'bg-gold-50 text-gold-700'
                            : 'bg-brand-50 text-brand-700',
                      )}
                    >
                      <span className="text-[10px] font-semibold uppercase">
                        {new Date(sitting.startsAt).toLocaleDateString('en-NG', { month: 'short' })}
                      </span>
                      <span className="tnum text-[15px] leading-none font-bold">
                        {new Date(sitting.startsAt).getDate()}
                      </span>
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold text-ink-900">
                          {matter?.caseId ?? 'Matter'}
                        </span>
                        <Badge tone={label.tone} size="sm">
                          {label.text}
                        </Badge>
                        <Badge tone="neutral" size="sm">
                          {sitting.purpose}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-ink-700">
                        {matter?.title ?? '—'}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-500">
                        <span className="tnum">{formatHearingSlot(sitting.startsAt, sitting.durationMinutes)}</span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" aria-hidden />
                          {shortCourtName(court?.name)} · {sitting.courtRoom}
                        </span>
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
    </Card>
  );
}
