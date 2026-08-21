import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: ReactNode;
}

/**
 * A tab and its panel have to name each other for a screen reader to tie the
 * two together, so both ids are derived from one caller-supplied base.
 */
const tabDomId = (base: string, id: string) => `${base}-tab-${id}`;
const panelDomId = (base: string, id: string) => `${base}-panel-${id}`;

interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  /**
   * Prefix for the generated tab and panel ids — pass the same value to the
   * matching `<TabPanel>`. Required, and unique per strip on a page, because
   * two strips sharing a base would generate colliding ids.
   */
  idBase: string;
  /** `underline` for page-level tabs, `pill` for in-card segmented controls. */
  variant?: 'underline' | 'pill';
  className?: string;
  label?: string;
}

export function Tabs({
  items,
  active,
  onChange,
  idBase,
  variant = 'underline',
  className,
  label = 'Sections',
}: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const edges = useEdgeFades(listRef);

  // The strip scrolls, so the selected tab has to be brought into view — both
  // when the arrow keys walk past the edge and when a deep link opens a tab
  // that starts off-screen.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  /** Arrow, Home and End walk the strip (WAI-ARIA tabs pattern). */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = items.length - 1;
    const from = items.findIndex((item) => item.id === active);
    let to: number;
    switch (event.key) {
      case 'ArrowRight':
        to = from >= last ? 0 : from + 1;
        break;
      case 'ArrowLeft':
        to = from <= 0 ? last : from - 1;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = items[to];
    if (!next) return;
    onChange(next.id);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
  };

  /** Shared by both variants so the ARIA wiring cannot drift between them. */
  const ariaFor = (item: TabItem, selected: boolean) => ({
    role: 'tab' as const,
    type: 'button' as const,
    id: tabDomId(idBase, item.id),
    'aria-selected': selected,
    'aria-controls': panelDomId(idBase, item.id),
    // Only the selected tab takes a tab stop; the arrow keys reach the rest.
    tabIndex: selected ? 0 : -1,
    onClick: () => onChange(item.id),
  });

  if (variant === 'pill') {
    return (
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn('inline-flex gap-0.5 rounded-lg bg-ink-100 p-0.5', className)}
      >
        {items.map((item) => {
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              {...ariaFor(item, selected)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                selected ? 'bg-white text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-800',
              )}
            >
              {item.icon}
              {item.label}
              {item.count != null && <span className="tnum text-ink-400">{item.count}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn('relative border-b border-ink-200', className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="no-scrollbar -mb-px flex gap-0.5 overflow-x-auto"
      >
        {items.map((item) => {
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              {...ariaFor(item, selected)}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
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

      {/* Without this, a strip wider than its container just ends in a tab sliced
          down the middle, which reads as broken rather than scrollable. */}
      <FadeEdge side="left" show={edges.left} />
      <FadeEdge side="right" show={edges.right} />
    </div>
  );
}

function FadeEdge({ side, show }: { side: 'left' | 'right'; show: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute top-0 bottom-px w-10 transition-opacity duration-150',
        side === 'left'
          ? 'left-0 bg-gradient-to-r from-white to-transparent'
          : 'right-0 bg-gradient-to-l from-white to-transparent',
        show ? 'opacity-100' : 'opacity-0',
      )}
    />
  );
}

/** Tracks which ends of a scrolling strip still have content past the edge. */
function useEdgeFades(ref: RefObject<HTMLDivElement | null>) {
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      const slack = element.scrollWidth - element.clientWidth;
      setEdges({
        left: element.scrollLeft > 1,
        right: slack > 1 && element.scrollLeft < slack - 1,
      });
    };

    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [ref]);

  return edges;
}

/**
 * The region a tab controls. Kept deliberately unfocusable: every panel here
 * holds its own interactive content, so a tab stop on the wrapper would only
 * add a stop that does nothing.
 */
export function TabPanel({
  idBase,
  tab,
  children,
  className,
}: {
  idBase: string;
  /** The `TabItem.id` this panel belongs to. */
  tab: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={panelDomId(idBase, tab)}
      aria-labelledby={tabDomId(idBase, tab)}
      className={className}
    >
      {children}
    </div>
  );
}
