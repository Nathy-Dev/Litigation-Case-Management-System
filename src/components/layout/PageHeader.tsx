import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/Tooltip';

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="no-print mb-1.5">
      <ol className="flex flex-wrap items-center gap-1 text-[12px] text-ink-500">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.to && !last ? (
                <Link to={item.to} className="rounded transition-colors hover:text-brand-700">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={last ? 'text-ink-700' : undefined}>
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight className="size-3 text-ink-300" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  /** One short line of orientation. Anything longer belongs in `hint`. */
  description?: ReactNode;
  /** Background the reader needs once, revealed on demand. */
  hint?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  /** Meta chips rendered directly beneath the title. */
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  hint,
  crumbs,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('mb-5', className)}>
      {crumbs && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-[22px] leading-tight font-semibold text-ink-900 sm:text-[26px]">
              {title}
            </h1>
            {hint && <InfoHint label={hint} />}
          </div>
          {description && (
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">{description}</p>
          )}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="no-print flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
