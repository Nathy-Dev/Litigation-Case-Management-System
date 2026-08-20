import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { CaseFilters } from '@/lib/selectors/cases';
import { CASE_PRIORITIES, CASE_STATUSES } from '@/types';
import { useDataStore } from '@/store/dataStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { FilterMenu } from '@/components/ui/FilterMenu';
import { Badge } from '@/components/ui/Badge';

const HEARING_WINDOWS = [
  { value: 7, label: 'Sitting within 7 days' },
  { value: 14, label: 'Sitting within 14 days' },
  { value: 30, label: 'Sitting within 30 days' },
];

/** Search + facet row above the register. Advanced facets live in a drawer. */
export function CaseFilterBar({
  filters,
  onChange,
  onOpenAdvanced,
  activeCount,
}: {
  filters: CaseFilters;
  onChange: (patch: Partial<CaseFilters>) => void;
  onOpenAdvanced: () => void;
  activeCount: number;
}) {
  const courts = useDataStore((state) => state.courts);
  const caseTypes = useDataStore((state) => state.caseTypes);
  const users = useDataStore((state) => state.users);

  const fileHolders = users.filter((user) =>
    ['SUPER_ADMIN', 'ADMIN', 'LEGAL_STAFF'].includes(user.role),
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[15rem] flex-1">
          <Input
            value={filters.query ?? ''}
            onChange={(event) => onChange({ query: event.target.value })}
            placeholder="Search suit number, title, parties, counsel…"
            leading={<Search className="size-4" aria-hidden />}
            aria-label="Search the register"
            trailing={
              filters.query ? (
                <button
                  type="button"
                  onClick={() => onChange({ query: '' })}
                  aria-label="Clear search"
                  className="rounded text-ink-400 hover:text-ink-700"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : undefined
            }
          />
        </div>

        <FilterMenu
          label="Status"
          options={CASE_STATUSES.map((status) => ({ value: status, label: status }))}
          selected={filters.status ?? []}
          onChange={(values) => onChange({ status: values as CaseFilters['status'] })}
        />
        <FilterMenu
          label="Court"
          searchable
          width="w-80"
          options={courts.map((court) => ({ value: court.id, label: court.name }))}
          selected={filters.courtIds ?? []}
          onChange={(courtIds) => onChange({ courtIds })}
        />
        <FilterMenu
          label="Owner"
          searchable
          options={fileHolders.map((user) => ({ value: user.id, label: user.fullName }))}
          selected={filters.ownerIds ?? []}
          onChange={(ownerIds) => onChange({ ownerIds })}
        />
        <FilterMenu
          label="Priority"
          width="w-48"
          options={CASE_PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
          selected={filters.priority ?? []}
          onChange={(values) => onChange({ priority: values as CaseFilters['priority'] })}
        />
        <FilterMenu
          label="Case type"
          searchable
          width="w-72"
          align="right"
          options={caseTypes.map((type) => ({ value: type.id, label: type.name }))}
          selected={filters.caseTypeIds ?? []}
          onChange={(caseTypeIds) => onChange({ caseTypeIds })}
        />

        <Button
          variant="secondary"
          onClick={onOpenAdvanced}
          icon={<SlidersHorizontal className="size-4" aria-hidden />}
        >
          More
          {activeCount > 0 && (
            <Badge tone="brand" size="sm" className="ml-1.5">
              {activeCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Quick toggles — the three most common day-to-day questions. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {HEARING_WINDOWS.map((window) => {
          const active = filters.hearingWithinDays === window.value;
          return (
            <button
              key={window.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ hearingWithinDays: active ? null : window.value })}
              className={
                active
                  ? 'rounded-full bg-brand-700 px-2.5 py-1 text-[12px] font-medium text-white'
                  : 'rounded-full bg-white px-2.5 py-1 text-[12px] text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'
              }
            >
              {window.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={Boolean(filters.confidentialOnly)}
          onClick={() => onChange({ confidentialOnly: !filters.confidentialOnly })}
          className={
            filters.confidentialOnly
              ? 'rounded-full bg-gold-600 px-2.5 py-1 text-[12px] font-medium text-white'
              : 'rounded-full bg-white px-2.5 py-1 text-[12px] text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'
          }
        >
          Confidential only
        </button>
        <button
          type="button"
          aria-pressed={Boolean(filters.includeArchived)}
          onClick={() => onChange({ includeArchived: !filters.includeArchived })}
          className={
            filters.includeArchived
              ? 'rounded-full bg-ink-700 px-2.5 py-1 text-[12px] font-medium text-white'
              : 'rounded-full bg-white px-2.5 py-1 text-[12px] text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'
          }
        >
          Include archived
        </button>
      </div>
    </div>
  );
}
