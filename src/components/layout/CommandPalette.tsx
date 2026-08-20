import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, ScanText, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useUiStore } from '@/store/uiStore';
import { useCurrentUser, usePermission } from '@/store/authStore';
import { buildCaseRows, visibleToUser } from '@/lib/selectors/cases';
import { globalSearch, type SearchHit } from '@/lib/selectors/search';

const GROUP_ORDER: SearchHit['group'][] = [
  'Matters',
  'Documents',
  'Court dates',
  'Tasks',
  'Notes',
  'People',
];

/** Ctrl/⌘-K search across every entity, including scanned document text. */
export function CommandPalette() {
  const open = useUiStore((state) => state.commandPaletteOpen);
  const setOpen = useUiStore((state) => state.setCommandPalette);
  const data = useDataStore();
  const user = useCurrentUser();
  const can = usePermission();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global shortcut is registered once, regardless of the palette's state.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // Focus after the portal has painted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const visibleCaseIds = useMemo(() => {
    const rows = visibleToUser(buildCaseRows(data), user, can('case.view.all'));
    return new Set(rows.map((row) => row.record.id));
  }, [data, user, can]);

  const hits = useMemo(
    () => (query.trim().length < 2 ? [] : globalSearch(data, query, visibleCaseIds, 5)),
    [data, query, visibleCaseIds],
  );

  const grouped = useMemo(() => {
    const flat: SearchHit[] = [];
    for (const group of GROUP_ORDER) flat.push(...hits.filter((hit) => hit.group === group));
    return flat;
  }, [hits]);

  const go = (hit: SearchHit) => {
    setOpen(false);
    navigate(hit.link);
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[8vh] sm:p-6 sm:pt-[12vh]">
      <div
        className="animate-fade-in absolute inset-0 bg-ink-950/45 backdrop-blur-[2px]"
        role="presentation"
        onClick={() => setOpen(false)}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="animate-slide-up relative w-full max-w-2xl overflow-hidden rounded-card bg-white shadow-overlay"
      >
        <div className="flex items-center gap-3 border-b border-ink-200 px-4">
          <Search className="size-4.5 shrink-0 text-ink-400" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor((c) => Math.min(c + 1, grouped.length - 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              }
              if (event.key === 'Enter' && grouped[cursor]) go(grouped[cursor]);
            }}
            placeholder="Search suit numbers, parties, documents, hearings, people…"
            aria-label="Search"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink-900 outline-none placeholder:text-ink-400"
          />
          <kbd className="hidden shrink-0 rounded border border-ink-250 px-1.5 py-0.5 text-[10px] text-ink-500 sm:block">
            Esc
          </kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto py-1.5">
          {query.trim().length < 2 && (
            <p className="px-4 py-8 text-center text-[13px] text-ink-500">
              Type at least two characters. Document text captured by OCR is searched too.
            </p>
          )}

          {query.trim().length >= 2 && grouped.length === 0 && (
            <p className="px-4 py-8 text-center text-[13px] text-ink-500">
              No matches for “{query}”. Try a suit number, a party name or a court.
            </p>
          )}

          {GROUP_ORDER.map((group) => {
            const rows = grouped.filter((hit) => hit.group === group);
            if (rows.length === 0) return null;
            return (
              <div key={group}>
                <p className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-ink-400 uppercase">
                  {group}
                </p>
                {rows.map((hit) => {
                  const index = grouped.indexOf(hit);
                  return (
                    <button
                      key={`${hit.group}-${hit.id}`}
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => go(hit)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-2 text-left transition-colors',
                        index === cursor ? 'bg-brand-50' : 'hover:bg-ink-50',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium text-ink-900">{hit.title}</span>
                          {hit.viaOcr && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-info-50 px-1.5 py-0.5 text-[10px] font-medium text-info-700">
                              <ScanText className="size-3" aria-hidden />
                              OCR
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-ink-500">{hit.subtitle}</span>
                        {hit.snippet && (
                          <span className="mt-0.5 block truncate text-[12px] text-ink-400 italic">
                            “{hit.snippet}”
                          </span>
                        )}
                      </span>
                      {index === cursor && (
                        <CornerDownLeft className="mt-1 size-3.5 shrink-0 text-brand-500" aria-hidden />
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {grouped.length > 0 && (
          <div className="flex items-center justify-between border-t border-ink-200 bg-ink-50/60 px-4 py-2 text-[11px] text-ink-500">
            <span>↑↓ to move · Enter to open</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(`/search?q=${encodeURIComponent(query)}`);
              }}
              className="font-medium text-brand-700 hover:text-brand-800"
            >
              See all results
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
