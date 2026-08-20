import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, FileText, Gavel, ListChecks, ScanText, Search, StickyNote, Users } from 'lucide-react';
import { globalSearch, type SearchGroup, type SearchHit } from '@/lib/selectors/search';
import { cn } from '@/lib/utils';
import { useDataset, useVisibleCaseRows } from '@/hooks/useCaseData';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';

const GROUPS: SearchGroup[] = ['Matters', 'Documents', 'Court dates', 'Tasks', 'Notes', 'People'];

const ICONS: Record<SearchGroup, typeof Search> = {
  Matters: Gavel,
  Documents: FileText,
  'Court dates': CalendarClock,
  Tasks: ListChecks,
  Notes: StickyNote,
  People: Users,
};

/** Highlights each occurrence of the query inside a snippet. */
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (needle.length < 2) return <>{text}</>;
  const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === needle.toLowerCase() ? (
          <mark key={index} className="rounded bg-gold-100 px-0.5 text-ink-900">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function Hit({ hit, query }: { hit: SearchHit; query: string }) {
  const Icon = ICONS[hit.group];
  return (
    <li className="border-b border-ink-100 last:border-b-0">
      <Link to={hit.link} className="flex gap-3 px-3 py-3 hover:bg-ink-50/70">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-ink-900">
              <Highlight text={hit.title} query={query} />
            </span>
            {hit.viaOcr && (
              <Badge tone="gold" size="sm">
                <ScanText className="mr-1 inline size-3" aria-hidden />
                Found in scanned text
              </Badge>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-ink-600">{hit.subtitle}</span>
          {hit.snippet && (
            <span className="mt-1 block text-[12px] text-ink-700">
              <Highlight text={hit.snippet} query={query} />
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** Full-text search results across every entity the user may see (TOR §16, §25). */
export function SearchResultsPage() {
  const [params, setParams] = useSearchParams();
  const data = useDataset();
  const rows = useVisibleCaseRows();

  const query = params.get('q') ?? '';
  const [group, setGroup] = useState<SearchGroup | 'all'>('all');

  const hits = useMemo(() => {
    const visible = new Set(rows.map((row) => row.record.id));
    return globalSearch(data, query, visible, 40);
  }, [data, query, rows]);

  const counts = useMemo(() => {
    const map = new Map<SearchGroup, number>();
    hits.forEach((hit) => map.set(hit.group, (map.get(hit.group) ?? 0) + 1));
    return map;
  }, [hits]);

  const visible = group === 'all' ? hits : hits.filter((hit) => hit.group === group);

  return (
    <div>
      <PageHeader
        title="Search"
        hint="Matter details, document names and their scanned contents, the court diary, tasks, notes and people — limited to the matters you may see."
      />

      <div className="space-y-3">
        <Input
          value={query}
          onChange={(event) => setParams(event.target.value ? { q: event.target.value } : {})}
          placeholder="Search everything — try a suit number, a party, a court or a phrase"
          leading={<Search className="size-4" aria-hidden />}
          aria-label="Search everything"
        />

        {query.trim().length >= 2 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setGroup('all')}
              aria-pressed={group === 'all'}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
                group === 'all'
                  ? 'border-brand-500 bg-brand-600 text-white'
                  : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50',
              )}
            >
              Everything ({hits.length})
            </button>
            {GROUPS.filter((item) => counts.get(item)).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setGroup(item)}
                aria-pressed={group === item}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
                  group === item
                    ? 'border-brand-500 bg-brand-600 text-white'
                    : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50',
                )}
              >
                {item} ({counts.get(item)})
              </button>
            ))}
          </div>
        )}

        <Card flush>
          {query.trim().length < 2 ? (
            <CardBody>
              <EmptyState
                icon={<Search className="size-5" aria-hidden />}
                title="Type at least two characters"
                description="Press Ctrl+K anywhere in the system to search without leaving the page you are on."
              />
            </CardBody>
          ) : visible.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<Search className="size-5" aria-hidden />}
                title={`Nothing matches “${query}”`}
                description="Check the spelling, try a suit number or a party name, or search a shorter phrase."
              />
            </CardBody>
          ) : (
            <ul>
              {visible.map((hit) => (
                <Hit key={`${hit.group}-${hit.id}`} hit={hit} query={query} />
              ))}
            </ul>
          )}
        </Card>

        {visible.length > 0 && (
          <p className="text-[11px] text-ink-500">
            {visible.length} result{visible.length === 1 ? '' : 's'} shown. Confidential matters you
            are not on are excluded from these results.
          </p>
        )}
      </div>
    </div>
  );
}
