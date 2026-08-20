import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dropdown } from './Dropdown';
import { Input } from './Input';

export interface FilterOption {
  value: string;
  label: string;
  /** Optional count shown on the right, e.g. how many matters carry the tag. */
  count?: number;
}

/**
 * Multi-select filter menu. Selection is applied immediately (no Apply button)
 * because every list in the app filters client-side against the mock dataset.
 */
export function FilterMenu({
  label,
  options,
  selected,
  onChange,
  width = 'w-64',
  searchable,
  align = 'left',
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  width?: string;
  searchable?: boolean;
  align?: 'left' | 'right';
}) {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    if (!query.trim()) return options;
    const needle = query.trim().toLowerCase();
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    );
  };

  const count = selected.length;

  return (
    <Dropdown
      align={align}
      width={width}
      trigger={({ open, toggle: toggleMenu }) => (
        <button
          type="button"
          onClick={toggleMenu}
          aria-expanded={open}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors',
            count > 0
              ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200'
              : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50',
          )}
        >
          {label}
          {count > 0 && (
            <span className="tnum rounded-full bg-brand-600 px-1.5 text-[10px] leading-4 font-semibold text-white">
              {count}
            </span>
          )}
          <ChevronDown
            className={cn('size-3.5 text-ink-400 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
      )}
    >
      <div className="max-h-80 overflow-y-auto">
        {searchable && (
          <div className="px-2 pt-1 pb-2">
            <Input
              sizing="sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Filter ${label.toLowerCase()}…`}
              leading={<Search className="size-3.5" aria-hidden />}
              aria-label={`Search ${label}`}
            />
          </div>
        )}

        {count > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12px] text-ink-500 hover:bg-ink-50 hover:text-ink-800"
          >
            <X className="size-3" aria-hidden />
            Clear {count} selected
          </button>
        )}

        {shown.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-ink-400">No matches.</p>
        ) : (
          <ul role="none">
            {shown.map((option) => {
              const active = selected.includes(option.value);
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={active}
                    onClick={() => toggle(option.value)}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-ink-700 transition-colors hover:bg-ink-50"
                  >
                    <span
                      className={cn(
                        'grid size-4 shrink-0 place-items-center rounded border transition-colors',
                        active
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-ink-300 bg-white',
                      )}
                      aria-hidden
                    >
                      {active && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.count !== undefined && (
                      <span className="tnum text-[11px] text-ink-400">{option.count}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dropdown>
  );
}
