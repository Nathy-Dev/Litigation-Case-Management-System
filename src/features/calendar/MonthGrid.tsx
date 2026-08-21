import { useState } from 'react';
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { CalendarEntry } from '@/lib/selectors/calendar';
import { dayKeyOf, groupByDay } from '@/lib/selectors/calendar';
import { shortMatterLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PRIORITY_TONE } from '@/components/ui/Badge';

const TONE_BAR: Record<string, string> = {
  danger: 'bg-danger-500',
  gold: 'bg-gold-500',
  brand: 'bg-brand-500',
  info: 'bg-info-500',
  neutral: 'bg-ink-400',
  success: 'bg-brand-500',
};

/**
 * Month view (TOR §11). Sittings can be dragged onto another day to reschedule
 * — the same gesture the clerks use when the registry moves a date.
 */
export function MonthGrid({
  anchor,
  entries,
  onOpen,
  onReschedule,
  onCreate,
  canReschedule,
}: {
  anchor: Date;
  entries: CalendarEntry[];
  onOpen: (entry: CalendarEntry) => void;
  onReschedule: (entry: CalendarEntry, day: Date) => void;
  onCreate?: (day: Date) => void;
  canReschedule: boolean;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const byDay = groupByDay(entries);

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }),
  });

  const weekdays = eachDayOfInterval({
    start: startOfWeek(anchor, { weekStartsOn: 1 }),
    end: addDays(startOfWeek(anchor, { weekStartsOn: 1 }), 6),
  });

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
      <div className="grid grid-cols-7 border-b border-ink-200 bg-ink-50">
        {weekdays.map((day) => (
          <div
            key={day.toISOString()}
            className="px-2 py-2 text-center text-[11px] font-semibold tracking-wide text-ink-500 uppercase"
          >
            <span className="hidden sm:inline">{format(day, 'EEEE')}</span>
            <span className="sm:hidden">{format(day, 'EEE')}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = dayKeyOf(day);
          const cell = byDay.get(key) ?? [];
          const outside = !isSameMonth(day, anchor);
          const weekend = [0, 6].includes(day.getDay());

          return (
            <div
              key={key}
              onDragOver={(event) => {
                if (!canReschedule) return;
                event.preventDefault();
                setDragOver(key);
              }}
              onDragLeave={() => setDragOver((current) => (current === key ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(null);
                if (!canReschedule) return;
                const id = event.dataTransfer.getData('text/plain');
                const entry = entries.find((item) => item.courtDate.id === id);
                if (entry && entry.dayKey !== key) onReschedule(entry, day);
              }}
              className={cn(
                'min-h-[6.5rem] border-r border-b border-ink-100 p-1.5 last:border-r-0',
                outside && 'bg-ink-50/60',
                weekend && !outside && 'bg-ink-50/30',
                dragOver === key && 'bg-brand-50 ring-2 ring-inset ring-brand-400',
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    'tnum inline-grid size-5.5 place-items-center rounded-full text-[11px]',
                    isToday(day)
                      ? 'bg-brand-600 font-semibold text-white'
                      : outside
                        ? 'text-ink-300'
                        : 'text-ink-600',
                  )}
                >
                  {format(day, 'd')}
                </span>
                {onCreate && !outside && (
                  <button
                    type="button"
                    onClick={() => onCreate(day)}
                    className="rounded text-[15px] leading-none text-ink-300 opacity-0 transition-opacity hover:text-brand-600 focus-visible:opacity-100 group-hover:opacity-100 hover:opacity-100"
                    aria-label={`Schedule a sitting on ${format(day, 'd MMMM yyyy')}`}
                  >
                    +
                  </button>
                )}
              </div>

              <ul className="space-y-1">
                {cell.slice(0, 3).map((entry) => {
                  const tone = PRIORITY_TONE[entry.row.record.priority];
                  return (
                    <li key={entry.courtDate.id}>
                      <button
                        type="button"
                        draggable={canReschedule && !entry.courtDate.outcome}
                        onDragStart={(event) =>
                          event.dataTransfer.setData('text/plain', entry.courtDate.id)
                        }
                        onClick={() => onOpen(entry)}
                        className={cn(
                          'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] transition-colors hover:bg-ink-100',
                          entry.courtDate.outcome ? 'text-ink-400' : 'text-ink-700',
                          canReschedule && !entry.courtDate.outcome && 'cursor-grab active:cursor-grabbing',
                        )}
                        title={`${entry.row.record.caseId} — ${entry.courtDate.purpose} at ${format(new Date(entry.courtDate.startsAt), 'h:mm a')}`}
                      >
                        <span
                          className={cn('h-3 w-0.5 shrink-0 rounded-full', TONE_BAR[tone] ?? TONE_BAR.neutral)}
                          aria-hidden
                        />
                        <span className="tnum shrink-0 text-ink-500">
                          {format(new Date(entry.courtDate.startsAt), 'HH:mm')}
                        </span>
                        <span className="truncate">
                          {shortMatterLabel(entry.row.record.title)}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {cell.length > 3 && (
                  <li className="px-1 text-[10px] font-medium text-ink-500">
                    +{cell.length - 3} more
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
