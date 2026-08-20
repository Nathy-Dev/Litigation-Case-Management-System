import type { ReactNode } from 'react';
import { CalendarDays, CalendarRange, Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

export type CalendarViewMode = 'month' | 'week' | 'day';

const MODES: { value: CalendarViewMode; label: string; icon: ReactNode }[] = [
  { value: 'month', label: 'Month', icon: <CalendarDays className="size-3.5" aria-hidden /> },
  { value: 'week', label: 'Week', icon: <CalendarRange className="size-3.5" aria-hidden /> },
  { value: 'day', label: 'Day', icon: <Clock3 className="size-3.5" aria-hidden /> },
];

/** Period stepper, view switcher and filter row shared by every calendar view. */
export function CalendarToolbar({
  label,
  view,
  onView,
  onPrev,
  onNext,
  onToday,
  prevIcon,
  nextIcon,
  filters,
}: {
  label: string;
  view: CalendarViewMode;
  onView: (view: CalendarViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  prevIcon: ReactNode;
  nextIcon: ReactNode;
  filters?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" onClick={onPrev} aria-label="Previous period" icon={prevIcon} />
          <Button size="icon" onClick={onNext} aria-label="Next period" icon={nextIcon} />
        </div>
        <Button size="sm" onClick={onToday}>
          Today
        </Button>

        <p className="ml-1 min-w-0 flex-1 truncate text-[15px] font-semibold text-ink-900">{label}</p>

        <div
          role="tablist"
          aria-label="Calendar view"
          className="flex items-center gap-0.5 rounded-lg bg-ink-100 p-0.5"
        >
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="tab"
              aria-selected={view === mode.value}
              onClick={() => onView(mode.value)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                view === mode.value
                  ? 'bg-white text-ink-900 shadow-xs'
                  : 'text-ink-600 hover:text-ink-900',
              )}
            >
              {mode.icon}
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {filters && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-2.5">
          {filters}
        </div>
      )}
    </div>
  );
}
