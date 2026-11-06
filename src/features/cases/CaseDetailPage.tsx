import { useMemo, useState } from 'react';
import { useAction } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRightLeft,
  CalendarDays,
  FileText,
  FolderOpen,
  Link2,
  ListTodo,
  MessageSquare,
  Pencil,
  Printer,
  History,
} from 'lucide-react';
import { formatDate, formatNaira, formatAge, shortCourtName } from '@/lib/format';
import { useCan } from '@/store/authStore';
import { useDataStore } from '@/store/dataStore';
import { useCaseRow } from '@/hooks/useCaseData';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { TabPanel, Tabs, type TabItem } from '@/components/ui/Tabs';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, ConfidentialBadge } from '@/components/ui/Badge';
import { CaseFactsPanel } from './CaseFactsPanel';
import { StatusChangeDialog } from './StatusChangeDialog';
import { TimelineTab } from './tabs/TimelineTab';
import { DocumentsTab } from './tabs/DocumentsTab';
import { CourtDatesTab } from './tabs/CourtDatesTab';
import { CaseTasksTab } from './tabs/CaseTasksTab';
import { NotesTab } from './tabs/NotesTab';
import { RelatedTab } from './tabs/RelatedTab';

export function CaseDetailPage() {
  const exportDossier = useAction(api.documents.exportDossier);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const { caseId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const row = useCaseRow(caseId);
  const documents = useDataStore((state) => state.documents);
  const courtDates = useDataStore((state) => state.courtDates);
  const tasks = useDataStore((state) => state.tasks);
  const notes = useDataStore((state) => state.notes);
  const canEdit = useCan('case.edit');
  const canDownload = useCan('document.download');
  const canChangeStatus = useCan('case.status.change');

  const [statusOpen, setStatusOpen] = useState(false);
  const active = params.get('tab') ?? 'timeline';

  const counts = useMemo(() => {
    if (!row) return { documents: 0, courtDates: 0, tasks: 0, notes: 0, related: 0 };
    return {
      documents: documents.filter((item) => item.caseId === row.record.id).length,
      courtDates: courtDates.filter((item) => item.caseId === row.record.id).length,
      tasks: tasks.filter(
        (item) => item.caseId === row.record.id && item.status !== 'Completed',
      ).length,
      notes: notes.filter((item) => item.caseId === row.record.id).length,
      related: row.record.relatedCases.length,
    };
  }, [row, documents, courtDates, tasks, notes]);

  if (!row) {
    return (
      <Card className="mt-6">
        <EmptyState
          icon={<FolderOpen className="size-6" aria-hidden />}
          title="Matter not found"
          description="It may have been archived, or you may not have permission to view it."
          action={
            <ButtonLink to="/cases" variant="primary">
              Back to the register
            </ButtonLink>
          }
        />
      </Card>
    );
  }

  const { record } = row;

  const tabs: TabItem[] = [
    { id: 'timeline', label: 'Timeline', icon: <History className="size-4" aria-hidden /> },
    {
      id: 'documents',
      label: 'Documents',
      count: counts.documents,
      icon: <FileText className="size-4" aria-hidden />,
    },
    {
      id: 'court-dates',
      label: 'Court dates',
      count: counts.courtDates,
      icon: <CalendarDays className="size-4" aria-hidden />,
    },
    {
      id: 'tasks',
      label: 'Tasks',
      count: counts.tasks,
      icon: <ListTodo className="size-4" aria-hidden />,
    },
    {
      id: 'notes',
      label: 'Notes',
      count: counts.notes,
      icon: <MessageSquare className="size-4" aria-hidden />,
    },
    {
      id: 'related',
      label: 'Related cases',
      count: counts.related,
      icon: <Link2 className="size-4" aria-hidden />,
    },
  ];

  return (
    <>
      <PageHeader
        title={record.title}
        crumbs={[
          { label: 'Dashboard', to: '/' },
          { label: 'Cases', to: '/cases' },
          { label: record.caseId },
        ]}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-[12px] font-medium text-ink-700">{record.caseId}</span>
            {record.suitNumber && (
              <span className="font-mono text-[12px] text-ink-500">{record.suitNumber}</span>
            )}
            <StatusBadge status={record.status} size="sm" />
            {record.confidential && <ConfidentialBadge />}
          </span>
        }
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{shortCourtName(row.courtName)}</span>
            <span aria-hidden>·</span>
            <span>
              {row.nextHearing
                ? `Next sitting ${formatDate(row.nextHearing.startsAt)}`
                : 'No sitting fixed'}
            </span>
            {record.claimValue != null && (
              <>
                <span aria-hidden>·</span>
                <span className="tnum">{formatNaira(record.claimValue)}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{formatAge(record.filingDate ?? record.createdAt)} old</span>
          </span>
        }
        actions={
          <>
            {canDownload && <Button disabled={exporting} onClick={async () => {
              setExporting(true); setExportError('');
              try { const result = await exportDossier({ caseId: caseId as Id<'cases'> }); const link = document.createElement('a'); link.href = result.url; link.download = result.name; link.target = '_blank'; link.rel = 'noopener'; link.click(); }
              catch (failure) { setExportError(failure instanceof Error ? failure.message : 'Export failed.'); }
              finally { setExporting(false); }
            }}>Export full dossier</Button>}
            <Button
              variant="ghost"
              onClick={() => window.print()}
              icon={<Printer className="size-4" aria-hidden />}
            >
              Print
            </Button>
            {canChangeStatus && (
              <Button
                variant="secondary"
                onClick={() => setStatusOpen(true)}
                icon={<ArrowRightLeft className="size-4" aria-hidden />}
              >
                Change status
              </Button>
            )}
            {canEdit && (
              <ButtonLink
                to={`/cases/${record.id}/edit`}
                variant="primary"
                icon={<Pencil className="size-4" aria-hidden />}
              >
                Edit matter
              </ButtonLink>
            )}
          </>
        }
      />

      {exportError && <p role="alert" className="mb-4 text-sm text-danger-600">{exportError}</p>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <h2 className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
              Summary
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-700">{record.summary}</p>
            <h2 className="mt-4 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
              Relief sought
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-700">{record.reliefSought}</p>
          </Card>

          <div className="no-print">
            <Tabs
              items={tabs}
              active={active}
              idBase="case-detail"
              label="Case sections"
              onChange={(id) => {
                const next = new URLSearchParams(params);
                if (id === 'timeline') next.delete('tab');
                else next.set('tab', id);
                setParams(next, { replace: true });
              }}
            />
          </div>

          <div>
            <TabPanel idBase="case-detail" tab="timeline">{active === 'timeline' && <TimelineTab caseId={record.id} />}</TabPanel>
            <TabPanel idBase="case-detail" tab="documents">{active === 'documents' && <DocumentsTab caseRecord={record} />}</TabPanel>
            <TabPanel idBase="case-detail" tab="court-dates">{active === 'court-dates' && <CourtDatesTab caseRecord={record} />}</TabPanel>
            <TabPanel idBase="case-detail" tab="tasks">{active === 'tasks' && <CaseTasksTab caseRecord={record} />}</TabPanel>
            <TabPanel idBase="case-detail" tab="notes">{active === 'notes' && <NotesTab caseRecord={record} />}</TabPanel>
            <TabPanel idBase="case-detail" tab="related">{active === 'related' && <RelatedTab caseRecord={record} />}</TabPanel>
          </div>
        </div>

        <aside className="min-w-0">
          <CaseFactsPanel row={row} />
          <p className="mt-3 px-1 text-[11px] leading-relaxed text-ink-400">
            Opened {formatDate(record.createdAt)} ·{' '}
            <Link to="/admin/audit" className="hover:text-brand-700 hover:underline">
              View audit trail
            </Link>
          </p>
        </aside>
      </div>

      <StatusChangeDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        record={record}
      />
    </>
  );
}
