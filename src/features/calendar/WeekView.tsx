import { useState } from 'react';
import { addDays, eachDayOfInterval, format, isToday, startOfWeek } from 'date-fns';
import type { CalendarEntry } from '@/lib/selectors/calendar';
import { dayKeyOf, groupByDay } from '@/lib/selectors/calendar';
import { cn } from '@/lib/utils';
import { PRIORITY_TONE } from '@/components/ui/Badge';

/** Court sittings run 08:00–18:00; the grid shows one hour per 3.5rem row. */
const START_HOUR = 8;
const END_HOUR = 18;
const ROW_HEIGHT = 56;

const TONE_EDGE: Record<string, string> = {
  danger: 'border-l-danger-500',
  gold: 'border-l-gold-500',
  brand: 'border-l-brand-500',
  info: 'border-l-info-500',
  neutral: 'border-l-ink-400',
  success: 'border-l-brand-500',
};

function offsetFor(minutesFromMidnight: number) {
  const clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, minutesFromMidnight));
  return ((clamped - START_HOUR * 60) / 60) * ROW_HEIGHT;
}

/**
 * Week and day views (TOR §11). The two share a time grid — a day view is
 * simply a week of one column, so there is one implementation to maintain.
 */
export function WeekView({
  anchor,
  days: dayCount,
  entries,
  onOpen,
  onReschedule,
  onCreate,
  canReschedule,
}: {
  anchor: Date;
  /** 7 for the week view, 1 for the day view. */
  days: 1 | 7;
  entries: CalendarEntry[];
  onOpen: (entry: CalendarEntry) => void;
  onReschedule: (entry: CalendarEntry, day: Date) => void;
  onCreate?: (day: Date) => void;
  canReschedule: boolean;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const byDay = groupByDay(entries);

  const first = dayCount === 7 ? startOfWeek(anchor, { weekStartsOn: 1 }) : anchor;
  const days = eachDayOfInterval({ start: first, end: addDays(first, dayCount - 1) });
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index);

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
      <div
        className="grid border-b border-ink-200 bg-ink-50"
        style={{ gridTemplateColumns: `3.5rem repeat(${dayCount}, minmax(0, 1fr))` }}
      >
        <div aria-hidden />
        {days.map((day) => (
          <div
            key={dayKeyOf(day)}
            className={cn(
              'border-l border-ink-200 px-2 py-2 text-center',
              isToday(day) && 'bg-brand-50',
            )}
          >
            <p className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
              {format(day, 'EEE')}
            </p>
            <p
              className={cn(
                'tnum mt-0.5 text-[15px] font-semibold',
                isToday(day) ? 'text-brand-700' : 'text-ink-800',
              )}
            >
              {format(day, dayCount === 1 ? 'd MMMM yyyy' : 'd MMM')}
            </p>
          </div>
        ))}
      </div>

      <div className="max-h-[34rem] overflow-y-auto">
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `3.5rem repeat(${dayCount}, minmax(0, 1fr))` }}
        >
          <div className="border-r border-ink-100">
            {hours.map((hour) => (
              <div key={hour} className="relative" style={{ height: ROW_HEIGHT }}>
                <span className="tnum absolute -top-1.5 right-1.5 text-[10px] font-medium text-ink-400">
                  {`${hour}`.padStart(2, '0')}:00
                </span>
              </div>
            ))}
          </div>

          {days.map((day) => {
            const key = dayKeyOf(day);
            const cell = byDay.get(key) ?? [];

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
                  'relative border-l border-ink-100',
                  [0, 6].includes(day.getDay()) && 'bg-ink-50/40',
                  dragOver === key && 'bg-brand-50 ring-2 ring-inset ring-brand-400',
                )}
              >
                {hours.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    tabIndex={-1}
                    onClick={() => onCreate?.(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0))}
                    className="block w-full border-b border-ink-100 last:border-b-0"
                    style={{ height: ROW_HEIGHT }}
                    aria-label={`Schedule a sitting at ${hour}:00 on ${format(day, 'd MMMM yyyy')}`}
                  />
                ))}

                {cell.map((entry, index) => {
                  const tone = PRIORITY_TONE[entry.row.record.priority];
                  const height = Math.max(
                    30,
                    (entry.courtDate.durationMinutes / 60) * ROW_HEIGHT - 3,
                  );
                  const overlap = cell.filter(
                    (other, otherIndex) =>
                      otherIndex < index &&
                      Math.abs(other.minutesFromMidnight - entry.minutesFromMidnight) < 60,
                  ).length;

                  return (
                    <button
                      key={entry.courtDate.id}
                      type="button"
                      draggable={canReschedule && !entry.courtDate.outcome}
                      onDragStart={(event) =>
                        event.dataTransfer.setData('text/plain', entry.courtDate.id)
                      }
                      onClick={() => onOpen(entry)}
                      style={{
                        top: offsetFor(entry.minutesFromMidnight) + 1,
                        height,
                        left: `${overlap * 10 + 2}%`,
                        width: `${96 - overlap * 10}%`,
                      }}
                      className={cn(
                        'absolute overflow-hidden rounded-md border border-l-3 px-1.5 py-1 text-left shadow-xs transition-shadow hover:shadow-sm',
                        TONE_EDGE[tone] ?? TONE_EDGE.neutral,
                        entry.courtDate.outcome
                          ? 'border-ink-200 bg-ink-50 text-ink-500'
                          : 'border-ink-200 bg-white text-ink-800',
                        canReschedule && !entry.courtDate.outcome && 'cursor-grab active:cursor-grabbing',
                      )}
                    >
                      <p className="tnum truncate text-[10px] font-semibold text-ink-500">
                        {format(new Date(entry.courtDate.startsAt), 'HH:mm')} ·{' '}
                        {entry.row.record.caseId}
                      </p>
                      <p className="truncate text-[11px] font-medium">{entry.courtDate.purpose}</p>
                      {height > 44 && (
                        <p className="truncate text-[10px] text-ink-500">
                          {entry.courtDate.courtRoom} · {entry.row.record.title}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
