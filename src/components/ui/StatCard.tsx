import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Small supporting line under the value. */
  hint?: ReactNode;
  icon?: ReactNode;
  /** Signed percentage-style delta, e.g. +12%. */
  delta?: { value: string; direction: 'up' | 'down' | 'flat'; good?: boolean };
  tone?: 'default' | 'brand' | 'danger' | 'gold';
  to?: string;
  className?: string;
}

const TONES = {
  default: 'ring-ink-200/70',
  brand: 'ring-brand-200 bg-brand-50/40',
  danger: 'ring-danger-200 bg-danger-50/40',
  gold: 'ring-gold-200 bg-gold-50/40',
} as const;

const ICON_TONES = {
  default: 'bg-ink-100 text-ink-500',
  brand: 'bg-brand-100 text-brand-700',
  danger: 'bg-danger-100 text-danger-600',
  gold: 'bg-gold-100 text-gold-700',
} as const;

export function StatCard({
  label,
  value,
  hint,
  icon,
  delta,
  tone = 'default',
  to,
  className,
}: StatCardProps) {
  const DeltaIcon =
    delta?.direction === 'up' ? ArrowUpRight : delta?.direction === 'down' ? ArrowDownRight : Minus;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-medium tracking-wide text-ink-500 uppercase">{label}</p>
        {icon && (
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', ICON_TONES[tone])}>
            {icon}
          </span>
        )}
      </div>

      <p className="tnum mt-2 font-serif text-[26px] leading-none font-semibold text-ink-900">
        {value}
      </p>

      <div className="mt-2 flex items-center gap-2">
        {delta && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-[12px] font-medium',
              delta.direction === 'flat'
                ? 'text-ink-500'
                : delta.good === false
                  ? 'text-danger-600'
                  : 'text-brand-700',
            )}
          >
            <DeltaIcon className="size-3.5" aria-hidden />
            {delta.value}
          </span>
        )}
        {hint && <span className="truncate text-[12px] text-ink-500">{hint}</span>}
      </div>
    </>
  );

  const shell = cn(
    'rounded-card bg-white p-4 ring-1 shadow-card transition-shadow',
    TONES[tone],
    to && 'hover:shadow-raised',
    className,
  );

  return to ? (
    <Link to={to} className={cn(shell, 'block')}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

/** Thin labelled meter — storage quota, checklist progress, report shares. */
export function Meter({
  label,
  value,
  max,
  caption,
  tone = 'brand',
}: {
  label?: ReactNode;
  value: number;
  max: number;
  caption?: ReactNode;
  tone?: 'brand' | 'danger' | 'gold' | 'info';
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fill = {
    brand: 'bg-brand-500',
    danger: 'bg-danger-500',
    gold: 'bg-gold-500',
    info: 'bg-info-500',
  }[tone];

  return (
    <div>
      {(label || caption) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label && <span className="text-[13px] font-medium text-ink-700">{label}</span>}
          {caption && <span className="tnum text-[12px] text-ink-500">{caption}</span>}
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-ink-150"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={typeof label === 'string' ? label : 'Progress'}
      >
        <span className={cn('block h-full rounded-full transition-all', fill)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
