import { Link } from 'react-router-dom';
import { CalendarPlus, Eye, FileText, MoreHorizontal, Pencil } from 'lucide-react';
import type { Column } from '@/components/ui/DataTable';
import type { CaseRow } from '@/lib/selectors/cases';
import { formatDate, formatNaira, shortCourtName } from '@/lib/format';
import { cn } from '@/lib/utils';
import { StatusBadge, PriorityBadge, ConfidentialBadge } from '@/components/ui/Badge';
import { Dropdown, MenuItem, MenuSeparator } from '@/components/ui/Dropdown';
import { UserCell } from '@/components/ui/Avatar';
import { daysUntil } from '@/lib/format';

/**
 * The register columns named in TOR §36 — Case ID, Title, Parties, Court, Owner,
 * Status, Next Hearing, Actions — plus the extras the Legal Unit asked for.
 */
export function caseColumns({
  canEdit,
  navigate,
  onSchedule,
}: {
  canEdit: boolean;
  /** Router navigate — never window.location, which would reset the demo data. */
  navigate: (to: string) => void;
  onSchedule?: (row: CaseRow) => void;
}): Column<CaseRow>[] {
  return [
    {
      key: 'caseId',
      header: 'Case ID',
      sortKey: 'caseId',
      width: '10.5rem',
      cell: (row) => (
        <span className="block">
          <Link
            to={`/cases/${row.record.id}`}
            className="block truncate font-mono text-[12px] font-medium text-brand-700 hover:underline"
          >
            {row.record.caseId}
          </Link>
          {row.record.suitNumber && (
            <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-400">
              {row.record.suitNumber}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      sortKey: 'title',
      cell: (row) => (
        <span className="block">
          <span className="flex items-center gap-1.5">
            <Link
              to={`/cases/${row.record.id}`}
              title={row.record.title}
              className="min-w-0 truncate text-[13px] font-medium text-ink-900 hover:text-brand-700"
            >
              {row.record.title}
            </Link>
            {row.record.confidential && <ConfidentialBadge />}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-500">
            <PriorityBadge priority={row.record.priority} size="sm" />
            <span className="min-w-0 truncate">{row.caseTypeName}</span>
            {row.record.claimValue ? (
              <span className="tnum hidden shrink-0 lg:inline">
                {formatNaira(row.record.claimValue)}
              </span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      key: 'parties',
      header: 'Parties',
      width: '11rem',
      hideBelow: '2xl',
      cell: (row) => (
        <span className="block truncate text-[12px] text-ink-600" title={row.partiesLabel}>
          {row.partiesLabel}
        </span>
      ),
    },
    {
      key: 'court',
      header: 'Court',
      sortKey: 'courtName',
      width: '9rem',
      hideBelow: 'lg',
      cell: (row) => (
        <span className="block">
          <span className="block truncate text-[12px] text-ink-700">
            {shortCourtName(row.courtName)}
          </span>
          {row.record.presidingJudge && (
            <span className="mt-0.5 block truncate text-[11px] text-ink-400">
              {row.record.presidingJudge}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      hideBelow: 'md',
      width: '11rem',
      cell: (row) => <UserCell user={row.owner} />,
    },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      width: '7.5rem',
      cell: (row) => <StatusBadge status={row.record.status} size="sm" />,
    },
    {
      key: 'nextHearing',
      header: 'Next hearing',
      sortKey: 'nextHearing',
      width: '8rem',
      cell: (row) => {
        if (!row.nextHearing) return <span className="text-[12px] text-ink-400">No date fixed</span>;
        const days = daysUntil(row.nextHearing.startsAt);
        return (
          <span className="block">
            <span
              className={cn(
                'tnum block text-[12px] font-medium',
                days === 0 ? 'text-danger-700' : days <= 3 ? 'text-gold-700' : 'text-ink-800',
              )}
            >
              {formatDate(row.nextHearing.startsAt)}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-ink-500">
              {row.nextHearing.purpose}
            </span>
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      width: '3.25rem',
      cell: (row) => (
        <Dropdown
          width="w-52"
          trigger={({ toggle }) => (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                toggle();
              }}
              aria-label={`Actions for ${row.record.caseId}`}
              className="rounded-md p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon={<Eye className="size-4" aria-hidden />}
                onClick={() => {
                  close();
                  navigate(`/cases/${row.record.id}`);
                }}
              >
                Open matter
              </MenuItem>
              <MenuItem
                icon={<FileText className="size-4" aria-hidden />}
                hint={String(row.documentCount)}
                onClick={() => {
                  close();
                  navigate(`/cases/${row.record.id}?tab=documents`);
                }}
              >
                Documents
              </MenuItem>
              {canEdit && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon={<Pencil className="size-4" aria-hidden />}
                    onClick={() => {
                      close();
                      navigate(`/cases/${row.record.id}/edit`);
                    }}
                  >
                    Edit details
                  </MenuItem>
                  <MenuItem
                    icon={<CalendarPlus className="size-4" aria-hidden />}
                    onClick={() => {
                      close();
                      onSchedule?.(row);
                    }}
                  >
                    Schedule sitting
                  </MenuItem>
                </>
              )}
            </>
          )}
        </Dropdown>
      ),
    },
  ];
}

