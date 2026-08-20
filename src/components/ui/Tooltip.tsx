import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const SIDES = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
} as const;

/**
 * Hover *and* focus triggered, and wired with `aria-describedby` so the hint is
 * not mouse-only — WCAG 2.1 AA needs keyboard users to reach it too.
 */
export function Tooltip({ label, children, side = 'top', className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'animate-fade-in pointer-events-none absolute z-50 w-max max-w-[16rem] rounded-lg bg-ink-900 px-2 py-1 text-[11px] leading-snug text-white shadow-overlay',
            SIDES[side],
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}

/** Inline "what does this mean" marker for column headers and settings rows. */
export function InfoHint({ label }: { label: ReactNode }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label="More information"
        className="grid size-4 place-items-center rounded-full bg-ink-150 text-[10px] font-bold text-ink-500 transition-colors hover:bg-ink-200 hover:text-ink-700"
      >
        ?
      </button>
    </Tooltip>
  );
}
