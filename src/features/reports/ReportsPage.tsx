import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileSpreadsheet, Printer, Sparkles, Wand2 } from 'lucide-react';
import type { ReportId } from '@/types';
import { runReport } from '@/lib/selectors/reports';
import { downloadCsv, printReport, slugify } from '@/lib/exportFile';
import { formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCan, useCurrentUser } from '@/store/authStore';
import { useDataset, useVisibleCaseRows } from '@/hooks/useCaseData';
import { notify } from '@/store/uiStore';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select } from '@/components/ui/Input';
import { ReportTable } from './ReportTable';

const WINDOWS = [
  { value: 7, label: 'Next 7 days' },
  { value: 14, label: 'Next 14 days' },
  { value: 30, label: 'Next 30 days' },
  { value: 90, label: 'Next 90 days' },
];

/** The six standard reports named in the TOR (§20–22), with CSV and PDF export. */
export function ReportsPage() {
  const data = useDataset();
  const rows = useVisibleCaseRows();
  const users = useDataStore((state) => state.users);
  const recordAudit = useDataStore((state) => state.recordAudit);
  const user = useCurrentUser();
  const canExport = useCan('report.export');
  const canBuild = useCan('report.build');

  const [selected, setSelected] = useState<ReportId>('caseload-by-status');
  const [windowDays, setWindowDays] = useState(30);
  const [ownerId, setOwnerId] = useState<string>('');

  const definition = data.reports.find((report) => report.id === selected)!;
  const result = useMemo(
    () => runReport(selected, data, rows, { windowDays, ownerId: ownerId || null }),
    [selected, data, rows, windowDays, ownerId],
  );

  const owners = useMemo(() => {
    const ids = new Set(rows.map((row) => row.record.matterOwnerId));
    return users.filter((item) => ids.has(item.id));
  }, [rows, users]);

  const stamp = `Generated ${formatDateTime(new Date())} by ${user?.fullName ?? 'the system'} · ${formatNumber(result.rows.length)} rows`;

  const onCsv = () => {
    downloadCsv(`${slugify(definition.name)}.csv`, result.columns, result.rows);
    recordAudit({
      actorId: user?.id ?? 'system',
      action: 'report.exported',
      entity: 'Report',
      entityId: definition.id,
      entityLabel: definition.name,
      metadata: { format: 'csv', rows: result.rows.length },
    });
    notify({ variant: 'success', title: 'CSV downloaded', description: definition.name });
  };

  const onPdf = () => {
    printReport({
      title: definition.name,
      caption: result.caption,
      columns: result.columns,
      rows: result.rows,
      footer: stamp,
    });
    recordAudit({
      actorId: user?.id ?? 'system',
      action: 'report.exported',
      entity: 'Report',
      entityId: definition.id,
      entityLabel: definition.name,
      metadata: { format: 'pdf', rows: result.rows.length },
    });
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        hint="Standard management reports for the unit. Every export is written to the audit trail."
        actions={
          canBuild && (
            <Link to="/reports/builder">
              <Button icon={<Wand2 className="size-4" aria-hidden />}>Ad-hoc report builder</Button>
            </Link>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
        <Card flush>
          <CardHeader title="Standard reports" hint="The six reports required by the TOR." />
          <nav aria-label="Standard reports" className="border-t border-ink-200">
            <ul>
              {data.reports.map((report) => (
                <li key={report.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(report.id)}
                    aria-current={selected === report.id}
                    className={cn(
                      'w-full border-b border-ink-100 px-4 py-2.5 text-left transition-colors last:border-b-0 sm:px-5',
                      selected === report.id
                        ? 'bg-brand-50 text-brand-900'
                        : 'text-ink-700 hover:bg-ink-50',
                    )}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-semibold">
                      <FileSpreadsheet
                        className={cn(
                          'size-4 shrink-0',
                          selected === report.id ? 'text-brand-600' : 'text-ink-400',
                        )}
                        aria-hidden
                      />
                      {report.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title={definition.name}
              description={definition.description}
              actions={
                canExport && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={onCsv}
                      icon={<Download className="size-4" aria-hidden />}
                    >
                      CSV
                    </Button>
                    <Button
                      size="sm"
                      onClick={onPdf}
                      icon={<Printer className="size-4" aria-hidden />}
                    >
                      PDF
                    </Button>
                  </div>
                )
              }
            />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                {selected === 'upcoming-hearings' && (
                  <div className="w-48">
                    <Field label="Window">
                      {(props) => (
                        <Select
                          value={windowDays}
                          onChange={(event) => setWindowDays(Number(event.target.value))}
                          {...props}
                        >
                          {WINDOWS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </div>
                )}
                <div className="w-64">
                  <Field label="Matter owner">
                    {(props) => (
                      <Select
                        value={ownerId}
                        onChange={(event) => setOwnerId(event.target.value)}
                        {...props}
                      >
                        <option value="">All lawyers</option>
                        {owners.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.fullName}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
                <Badge tone="neutral" size="sm">
                  {definition.requirement}
                </Badge>
              </div>

              <p className="flex items-center gap-1.5 text-[12px] text-ink-600">
                <Sparkles className="size-3.5 text-brand-500" aria-hidden />
                {result.caption}
              </p>
            </CardBody>
          </Card>

          <ReportTable columns={result.columns} rows={result.rows} footer={stamp} />
        </div>
      </div>
    </div>
  );
}
