import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { InfoHint } from './Tooltip';

/**
 * Whether the surrounding card has dropped its own padding. Header, body and
 * footer read this so they can supply their own inset instead — without it a
 * `<Card flush>` header sat hard against the border.
 */
const FlushCardContext = createContext(false);

interface CardProps {
  children: ReactNode;
  className?: string;
  /** Removes the default padding so tables can sit flush to the edge. */
  flush?: boolean;
  as?: 'div' | 'section' | 'article';
}

export function Card({ children, className, flush, as: Tag = 'div' }: CardProps) {
  return (
    <Tag
      className={cn(
        'rounded-card bg-white ring-1 ring-ink-200/70 shadow-card',
        !flush && 'p-4 sm:p-5',
        className,
      )}
    >
      <FlushCardContext.Provider value={Boolean(flush)}>{children}</FlushCardContext.Provider>
    </Tag>
  );
}

interface CardHeaderProps {
  title: ReactNode;
  /** Live detail — counts, sizes, dates. Always visible. */
  description?: ReactNode;
  /**
   * Standing explanation of what the section is for. Kept behind an info marker
   * so the page stays readable once the reader already knows the answer.
   */
  hint?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
  /** Use inside a flush card — adds the padding and a bottom rule. */
  divided?: boolean;
}

export function CardHeader({
  title,
  description,
  hint,
  actions,
  icon,
  className,
  divided,
}: CardHeaderProps) {
  const flush = useContext(FlushCardContext);
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3',
        // A flush card supplies no padding of its own, so the header must.
        (flush || divided) && 'px-4 py-3.5 sm:px-5',
        divided && 'border-b border-ink-200/70',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-brand-600">{icon}</span>}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 className="truncate text-[15px] font-semibold text-ink-900">{title}</h2>
            {hint && (
              <span className="shrink-0">
                <InfoHint label={hint} />
              </span>
            )}
          </div>
          {description && <p className="mt-0.5 text-[13px] text-ink-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  const flush = useContext(FlushCardContext);
  return (
    <div
      className={cn(
        // Inside a padded card the horizontal inset is already there; only the
        // gap below a header is needed, and not when the body stands alone.
        flush ? 'px-4 py-4 sm:px-5' : 'pt-4 first:pt-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  const flush = useContext(FlushCardContext);
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-ink-200/70 py-3',
        // In a padded card the rule has to bleed back out to the card edges.
        flush ? 'px-4 sm:px-5' : '-mx-4 mt-4 px-4 sm:-mx-5 sm:px-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Section heading used between cards on the longer pages. */
export function SectionHeading({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h2 className="font-serif text-lg font-semibold text-ink-900">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
