import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bookmark, Download, FolderOpen, Plus } from 'lucide-react';
import type { SortDirection } from '@/types';
import type { CaseFilters, CaseSortKey } from '@/lib/selectors/cases';
import { filterCaseRows, paginate, sortCaseRows } from '@/lib/selectors/cases';
import { formatDate, formatNumber } from '@/lib/format';
import { downloadBlob, toCsv } from '@/lib/utils';
import { useCan } from '@/store/authStore';
import { useDataStore } from '@/store/dataStore';
import { useUiStore, notify } from '@/store/uiStore';
import { useVisibleCaseRows } from '@/hooks/useCaseData';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { ButtonLink, Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Pagination, TableFooter } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { Dropdown, MenuItem, MenuLabel } from '@/components/ui/Dropdown';
import { CaseFilterBar } from './CaseFilterBar';
import { CaseAdvancedFilters } from './CaseAdvancedFilters';
import { caseColumns } from './caseColumns';

const EXPORT_COLUMNS = [
  { key: 'caseId', label: 'Case ID' },
  { key: 'suitNumber', label: 'Suit number' },
  { key: 'title', label: 'Title' },
  { key: 'parties', label: 'Parties' },
  { key: 'court', label: 'Court' },
  { key: 'caseType', label: 'Case type' },
  { key: 'owner', label: 'Matter owner' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'filingDate', label: 'Filed' },
  { key: 'nextHearing', label: 'Next hearing' },
  { key: 'claimValue', label: 'Claim value (NGN)' },
  { key: 'ageDays', label: 'Age (days)' },
  { key: 'documents', label: 'Documents' },
];

export function CaseListPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const rows = useVisibleCaseRows();
  const savedViews = useDataStore((state) => state.savedViews);
  const density = useUiStore((state) => state.density);
  const canCreate = useCan('case.create');
  const canEdit = useCan('case.edit');
  const canExport = useCan('report.export');

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<{ key: CaseSortKey; dir: SortDirection }>({
    key: 'nextHearing',
    dir: 'asc',
  });

  // The URL carries the shareable bits — search text and the attention preset.
  const preset = params.get('filter');
  const [filters, setFilters] = useState<CaseFilters>(() => ({
    query: params.get('q') ?? '',
    hearingWithinDays: preset === 'hearings' ? 7 : null,
    status: preset === 'active' ? ['Filed', 'Pending', 'Adjourned', 'Heard'] : undefined,
  }));

  const patchFilters = (patch: Partial<CaseFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
    if ('query' in patch) {
      const next = new URLSearchParams(params);
      if (patch.query) next.set('q', patch.query);
      else next.delete('q');
      setParams(next, { replace: true });
    }
  };

  const filtered = useMemo(() => {
    const matched = filterCaseRows(rows, filters);
    // "Needs attention" is a dashboard hand-off, not a stored filter field.
    const scoped =
      preset === 'attention'
        ? matched.filter(
            (row) =>
              row.overdueTasks > 0 ||
              row.record.priority === 'Critical' ||
              (!row.nextHearing &&
                ['Filed', 'Pending', 'Adjourned'].includes(row.record.status)),
          )
        : matched;
    return sortCaseRows(scoped, sort.key, sort.dir);
  }, [rows, filters, sort, preset]);

  const paged = paginate(filtered, page, pageSize);

  const activeCount = [
    filters.status?.length,
    filters.priority?.length,
    filters.courtIds?.length,
    filters.caseTypeIds?.length,
    filters.ownerIds?.length,
    filters.tags?.length,
    filters.teamIds?.length,
    filters.confidentialOnly ? 1 : 0,
    filters.hearingWithinDays ? 1 : 0,
    filters.filedFrom ? 1 : 0,
    filters.filedTo ? 1 : 0,
    filters.minClaimValue ? 1 : 0,
  ].reduce<number>((sum, value) => sum + (value ?? 0), 0);

  const columns = useMemo(
    () => caseColumns({ canEdit, navigate: (to) => navigate(to) }),
    [canEdit, navigate],
  );

  const exportCsv = () => {
    const csv = toCsv(
      EXPORT_COLUMNS,
      filtered.map((row) => ({
        caseId: row.record.caseId,
        suitNumber: row.record.suitNumber ?? '',
        title: row.record.title,
        parties: row.partiesLabel,
        court: row.courtName,
        caseType: row.caseTypeName,
        owner: row.owner?.fullName ?? '',
        status: row.record.status,
        priority: row.record.priority,
        filingDate: row.record.filingDate ? formatDate(row.record.filingDate) : '',
        nextHearing: row.nextHearing ? formatDate(row.nextHearing.startsAt) : '',
        claimValue: row.record.claimValue ?? '',
        ageDays: row.ageDays,
        documents: row.documentCount,
      })),
    );
    downloadBlob(`lcms-register-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
    notify({
      variant: 'success',
      title: 'Register exported',
      description: `${formatNumber(filtered.length)} rows written to CSV.`,
    });
  };

  const applySavedView = (viewFilters: Record<string, unknown>) => {
    setFilters({
      query: '',
      status: viewFilters.status as CaseFilters['status'],
      minClaimValue: (viewFilters.minClaimValue as number) ?? null,
      hearingWithinDays: (viewFilters.hearingWithinDays as number) ?? null,
      tags: viewFilters.tags as string[] | undefined,
    });
    if (viewFilters.sort) {
      setSort({
        key: viewFilters.sort as CaseSortKey,
        dir: (viewFilters.dir as SortDirection) ?? 'desc',
      });
    }
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Case register"
        hint="Every matter the Legal Unit is handling, with its current status and next sitting."
        crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Cases' }]}
        meta={`${formatNumber(filtered.length)} of ${formatNumber(rows.length)} matters`}
        actions={
          <>
            <Dropdown
              width="w-72"
              trigger={({ toggle }) => (
                <Button
                  variant="secondary"
                  onClick={toggle}
                  icon={<Bookmark className="size-4" aria-hidden />}
                >
                  Saved views
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuLabel>Shared views</MenuLabel>
                  {savedViews
                    .filter((view) => view.entity === 'cases')
                    .map((view) => (
                      <MenuItem
                        key={view.id}
                        hint={view.shared ? 'Shared' : 'Private'}
                        onClick={() => {
                          applySavedView(view.filters);
                          close();
                        }}
                      >
                        {view.name}
                      </MenuItem>
                    ))}
                </>
              )}
            </Dropdown>

            {canExport && (
              <Button
                variant="secondary"
                onClick={exportCsv}
                icon={<Download className="size-4" aria-hidden />}
              >
                Export
              </Button>
            )}
            {canCreate && (
              <ButtonLink to="/cases/new" variant="primary" icon={<Plus className="size-4" aria-hidden />}>
                New matter
              </ButtonLink>
            )}
          </>
        }
      />

      <div className="space-y-3">
        <CaseFilterBar
          filters={filters}
          onChange={patchFilters}
          onOpenAdvanced={() => setAdvancedOpen(true)}
          activeCount={activeCount}
        />

        <Card flush>
          <DataTable
            columns={columns}
            rows={paged.rows}
            rowKey={(row) => row.record.id}
            dense={density === 'compact'}
            caption="Case register"
            sort={{ key: sort.key, dir: sort.dir }}
            onSort={(key) =>
              setSort((current) => ({
                key: key as CaseSortKey,
                dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc',
              }))
            }
            onRowClick={(row) => navigate(`/cases/${row.record.id}`)}
            empty={
              <EmptyState
                icon={<FolderOpen className="size-6" aria-hidden />}
                title="No matters match these filters"
                description="Try widening the search, or clear the filters to see the full register."
                action={
                  <Button variant="secondary" onClick={() => setFilters({ query: '' })}>
                    Clear filters
                  </Button>
                }
              />
            }
          />
          {paged.total > 0 && (
            <TableFooter>
              <Pagination
                page={paged.page}
                pageCount={paged.pageCount}
                pageSize={paged.pageSize}
                total={paged.total}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                label="matters"
              />
            </TableFooter>
          )}
        </Card>
      </div>

      <CaseAdvancedFilters
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        filters={filters}
        onChange={patchFilters}
        onReset={() => setFilters({ query: '' })}
        resultCount={filtered.length}
      />
    </>
  );
}
