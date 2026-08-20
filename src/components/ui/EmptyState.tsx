import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div className={cn('text-center', compact ? 'py-6' : 'py-12', className)}>
      {icon && (
        <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-brand-50 text-brand-600">
          {icon}
        </span>
      )}
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-ink-500">
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn('block animate-pulse rounded bg-ink-200/70', className)} aria-hidden />;
}

/** Placeholder rows while a heavy view settles — keeps layout from jumping. */
export function SkeletonTable({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-ink-100" aria-hidden>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-3.5', columnIndex === 0 ? 'w-28' : columnIndex === 1 ? 'flex-1' : 'w-20')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-card bg-white p-5 ring-1 ring-ink-200/70', className)} aria-hidden>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-3 h-2.5 w-32" />
    </div>
  );
}
