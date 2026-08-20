import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DisclosureProps {
  title: ReactNode;
  /** Shown on the closed row so the reader can decide without opening it. */
  summary?: ReactNode;
  /** Right-aligned chip on the closed row — a count, a status, a total. */
  meta?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  /** Open on first render. Use for the one section that matters most. */
  defaultOpen?: boolean;
  /** Drop the content padding so a table can sit flush to the edges. */
  flush?: boolean;
  className?: string;
}

/**
 * A section the reader opens when they need it (WAI-ARIA disclosure pattern).
 * Long settings and reference pages become a scannable list of headings instead
 * of a wall of prose, and the detail is one keystroke away.
 */
export function Disclosure({
  title,
  summary,
  meta,
  icon,
  children,
  defaultOpen = false,
  flush,
  className,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <div
      className={cn(
        'rounded-card bg-white ring-1 shadow-card transition-shadow',
        open ? 'ring-brand-200' : 'ring-ink-200/70',
        className,
      )}
    >
      <h3>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full items-center gap-3 rounded-card px-4 py-3.5 text-left transition-colors hover:bg-ink-50/70 sm:px-5"
        >
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-ink-400 transition-transform',
              open && 'rotate-180 text-brand-600',
            )}
            aria-hidden
          />
          {icon && <span className="shrink-0 text-brand-600">{icon}</span>}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-ink-900">{title}</span>
            {summary && !open && (
              <span className="mt-0.5 block truncate text-[12px] text-ink-500">{summary}</span>
            )}
          </span>
          {meta && <span className="shrink-0">{meta}</span>}
        </button>
      </h3>

      <div id={id} hidden={!open}>
        <div className={cn('border-t border-ink-200/70', !flush && 'px-4 py-4 sm:px-5')}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Reveals secondary detail inline, without the card chrome. */
export function ShowMore({
  label = 'Show detail',
  hideLabel = 'Hide detail',
  children,
  className,
}: {
  label?: string;
  hideLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex items-center gap-1 rounded text-[12px] font-semibold text-brand-700 transition-colors hover:text-brand-800"
      >
        {open ? hideLabel : label}
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <div id={id} hidden={!open} className="mt-2">
        {children}
      </div>
    </div>
  );
}
