import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  /** `underline` for page-level tabs, `pill` for in-card segmented controls. */
  variant?: 'underline' | 'pill';
  className?: string;
  label?: string;
}

export function Tabs({
  items,
  active,
  onChange,
  variant = 'underline',
  className,
  label = 'Sections',
}: TabsProps) {
  if (variant === 'pill') {
    return (
      <div
        role="tablist"
        aria-label={label}
        className={cn('inline-flex gap-0.5 rounded-lg bg-ink-100 p-0.5', className)}
      >
        {items.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={active === item.id}
            onClick={() => onChange(item.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
              active === item.id
                ? 'bg-white text-ink-900 shadow-xs'
                : 'text-ink-500 hover:text-ink-800',
            )}
          >
            {item.icon}
            {item.label}
            {item.count != null && <span className="tnum text-ink-400">{item.count}</span>}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('border-b border-ink-200', className)}>
      <div role="tablist" aria-label={label} className="no-scrollbar -mb-px flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => onChange(item.id)}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
                selected
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-800',
              )}
            >
              {item.icon}
              {item.label}
              {item.count != null && (
                <span
                  className={cn(
                    'tnum rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                    selected ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-500',
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
