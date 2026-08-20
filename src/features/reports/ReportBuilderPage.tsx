import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Download, Printer, RotateCcw, Wand2 } from 'lucide-react';
import { downloadCsv, printReport, slugify } from '@/lib/exportFile';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCan, useCurrentUser } from '@/store/authStore';
import { useDataset, useVisibleCaseRows } from '@/hooks/useCaseData';
import { notify } from '@/store/uiStore';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select } from '@/components/ui/Input';
import { ReportTable } from './ReportTable';
import {
  buildRows,
  columnsFor,
  DEFAULT_COLUMNS,
  ENTITIES,
  FIELDS,
  groupRows,
  type BuilderEntity,
} from './builderFields';

/** Ad-hoc report builder (TOR §22): choose a subject, columns, grouping, export. */
export function ReportBuilderPage() {
  const data = useDataset();
  const rows = useVisibleCaseRows();
  const recordAudit = useDataStore((state) => state.recordAudit);
  const user = useCurrentUser();
  const canExport = useCan('report.export');

  const [entity, setEntity] = useState<BuilderEntity>('cases');
  const [selectedKeys, setSelectedKeys] = useState<string[]>(DEFAULT_COLUMNS.cases);
  const [groupBy, setGroupBy] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [title, setTitle] = useState('Ad-hoc report');
  const [limit, setLimit] = useState('');

  const fields = FIELDS[entity];
  const groupable = fields.filter((field) => field.groupable);

  const changeEntity = (next: BuilderEntity) => {
    setEntity(next);
    setSelectedKeys(DEFAULT_COLUMNS[next]);
    setGroupBy('');
    setSortKey('');
  };

  const toggleKey = (key: string) => {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : // Keep the catalogue order so the table reads predictably.
          fields.filter((field) => field.key === key || current.includes(field.key)).map((field) => field.key),
    );
  };

  const result = useMemo(() => {
    const all = buildRows(entity, data, rows);
    const sorted = sortKey
      ? [...all].sort((a, b) => {
          const compared = String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''), 'en-NG', {
            numeric: true,
          });
          return sortDir === 'asc' ? compared : -compared;
        })
      : all;
    const capped = limit && Number(limit) > 0 ? sorted.slice(0, Number(limit)) : sorted;

    if (groupBy) {
      const field = fields.find((item) => item.key === groupBy)!;
      return { ...groupRows(capped, groupBy, field.label), source: capped.length };
    }
    return { columns: columnsFor(entity, selectedKeys), rows: capped, source: capped.length };
  }, [entity, data, rows, selectedKeys, groupBy, sortKey, sortDir, limit, fields]);

  const stamp = `Generated ${formatDateTime(new Date())} by ${user?.fullName ?? 'the system'} · ${result.rows.length} rows`;

  const logExport = (format: 'csv' | 'pdf') =>
    recordAudit({
      actorId: user?.id ?? 'system',
      action: 'report.exported',
      entity: 'Report',
      entityId: 'ad-hoc',
      entityLabel: title,
      metadata: { format, entity, columns: selectedKeys.join(', '), groupBy: groupBy || 'none' },
    });

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Reports', to: '/reports' }, { label: 'Ad-hoc builder' }]}
        title="Ad-hoc report builder"
        hint="Build a one-off report over the matters you can see, then export it as CSV or PDF."
        actions={
          <div className="flex items-center gap-2">
            <Link to="/reports">
              <Button icon={<ArrowLeft className="size-4" aria-hidden />}>Standard reports</Button>
            </Link>
            {canExport && (
              <>
                <Button
                  onClick={() => {
                    downloadCsv(`${slugify(title)}.csv`, result.columns, result.rows);
                    logExport('csv');
                    notify({ variant: 'success', title: 'CSV downloaded', description: title });
                  }}
                  icon={<Download className="size-4" aria-hidden />}
                >
                  CSV
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    printReport({
                      title,
                      caption: `${ENTITIES.find((item) => item.value === entity)?.label} · ${result.rows.length} rows`,
                      columns: result.columns,
                      rows: result.rows,
                      footer: stamp,
                    });
                    logExport('pdf');
                  }}
                  icon={<Printer className="size-4" aria-hidden />}
                >
                  PDF
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <Card>
            <CardHeader title="1. Subject" description="What each row represents." />
            <CardBody className="space-y-2">
              {ENTITIES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => changeEntity(option.value)}
                  aria-pressed={entity === option.value}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                    entity === option.value
                      ? 'border-brand-400 bg-brand-50 text-brand-900'
                      : 'border-ink-200 text-ink-700 hover:bg-ink-50',
                  )}
                >
                  <span className="block text-[13px] font-semibold">{option.label}</span>
                  <span className="block text-[11px] text-ink-500">{option.description}</span>
                </button>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="2. Columns"
              description={`${selectedKeys.length} of ${fields.length} selected.`}
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedKeys(DEFAULT_COLUMNS[entity])}
                  icon={<RotateCcw className="size-4" aria-hidden />}
                  aria-label="Reset columns"
                />
              }
            />
            <CardBody className="space-y-1.5">
              {fields.map((field) => (
                <Checkbox
                  key={field.key}
                  checked={selectedKeys.includes(field.key)}
                  onChange={() => toggleKey(field.key)}
                  label={field.label}
                  disabled={Boolean(groupBy)}
                />
              ))}
              {groupBy && (
                <p className="pt-1 text-[11px] text-ink-500">
                  Columns are replaced by the grouped counts while a grouping is applied.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="3. Shape" description="Group, sort and cap the output." />
            <CardBody className="space-y-3">
              <Field label="Group by" hint="Produces a count and share per value.">
                {(props) => (
                  <Select
                    value={groupBy}
                    onChange={(event) => setGroupBy(event.target.value)}
                    {...props}
                  >
                    <option value="">No grouping — list every row</option>
                    {groupable.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                <Field label="Sort by">
                  {(props) => (
                    <Select
                      value={sortKey}
                      onChange={(event) => setSortKey(event.target.value)}
                      {...props}
                    >
                      <option value="">Default order</option>
                      {fields.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Direction">
                  {(props) => (
                    <Select
                      value={sortDir}
                      onChange={(event) => setSortDir(event.target.value as 'asc' | 'desc')}
                      {...props}
                    >
                      <option value="asc">A–Z</option>
                      <option value="desc">Z–A</option>
                    </Select>
                  )}
                </Field>
              </div>

              <Field label="Limit rows" hint="Leave blank for every row.">
                {(props) => (
                  <Input
                    type="number"
                    min={1}
                    value={limit}
                    onChange={(event) => setLimit(event.target.value)}
                    placeholder="e.g. 50"
                    {...props}
                  />
                )}
              </Field>

              <Field label="Report title" hint="Used as the file name and the PDF heading.">
                {(props) => (
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} {...props} />
                )}
              </Field>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-3">
          <Card>
            <CardBody className="flex flex-wrap items-center gap-2">
              <Wand2 className="size-4 text-brand-600" aria-hidden />
              <p className="text-[13px] text-ink-700">
                <span className="font-semibold text-ink-900">{title}</span> —{' '}
                {ENTITIES.find((item) => item.value === entity)?.label.toLowerCase()},{' '}
                {result.rows.length} row{result.rows.length === 1 ? '' : 's'}
                {groupBy ? ` grouped by ${fields.find((f) => f.key === groupBy)?.label.toLowerCase()}` : ''}
                .
              </p>
            </CardBody>
          </Card>
          <ReportTable columns={result.columns} rows={result.rows} footer={stamp} />
        </div>
      </div>
    </div>
  );
}
