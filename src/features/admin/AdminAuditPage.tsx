import { useMemo, useState } from 'react';
import { ClipboardList, Download, Globe, ShieldAlert } from 'lucide-react';
import type { AuditEntity, AuditLogEntry } from '@/types';
import { downloadCsv } from '@/lib/exportFile';
import { formatDateTime, formatNumber, formatTimestamp } from '@/lib/format';
import { useDataStore } from '@/store/dataStore';
import { useCan, useCurrentUser } from '@/store/authStore';
import { DAY_MS, useNow } from '@/hooks/useNow';
import { notify } from '@/store/uiStore';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterMenu } from '@/components/ui/FilterMenu';
import { Field, Input, Select } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { StatCard } from '@/components/ui/StatCard';

const ENTITIES: AuditEntity[] = [
  'Case',
  'Document',
  'CourtDate',
  'Task',
  'User',
  'Role',
  'Note',
  'Session',
  'Configuration',
  'Report',
  'Backup',
];

const RANGES = [
  { value: 1, label: 'Last 24 hours' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 0, label: 'Everything held' },
];

/** The audit trail: who did what, when, and from which address (TOR §17–19). */
export function AdminAuditPage() {
  const auditLog = useDataStore((state) => state.auditLog);
  const users = useDataStore((state) => state.users);
  const recordAudit = useDataStore((state) => state.recordAudit);
  const actor = useCurrentUser();
  const canExport = useCan('audit.export');
  const now = useNow();

  const [query, setQuery] = useState('');
  const [entities, setEntities] = useState<string[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [outcome, setOutcome] = useState('');
  const [days, setDays] = useState(7);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const cutoff = days ? now - days * DAY_MS : 0;
    return auditLog
      .filter((entry) => (cutoff ? new Date(entry.at).getTime() >= cutoff : true))
      .filter((entry) => (entities.length ? entities.includes(entry.entity) : true))
      .filter((entry) => (actors.length ? actors.includes(entry.actorId) : true))
      .filter((entry) => (outcome ? entry.outcome === outcome : true))
      .filter((entry) =>
        needle
          ? entry.action.toLowerCase().includes(needle) ||
            entry.entityLabel.toLowerCase().includes(needle) ||
            entry.ipAddress.includes(needle) ||
            (userById.get(entry.actorId)?.fullName.toLowerCase().includes(needle) ?? false)
          : true,
      )
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [auditLog, query, entities, actors, outcome, days, userById, now]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);

  const failures = filtered.filter((entry) => entry.outcome === 'failure').length;
  const addresses = new Set(filtered.map((entry) => entry.ipAddress)).size;

  const onExport = () => {
    downloadCsv(
      'audit-trail.csv',
      [
        { key: 'at', label: 'Timestamp' },
        { key: 'user', label: 'User' },
        { key: 'role', label: 'Role' },
        { key: 'action', label: 'Action' },
        { key: 'entity', label: 'Entity' },
        { key: 'label', label: 'Record' },
        { key: 'outcome', label: 'Outcome' },
        { key: 'ip', label: 'IP address' },
        { key: 'agent', label: 'Device' },
      ],
      filtered.map((entry) => ({
        at: formatTimestamp(entry.at),
        user: userById.get(entry.actorId)?.fullName ?? entry.actorId,
        role: userById.get(entry.actorId)?.role ?? '—',
        action: entry.action,
        entity: entry.entity,
        label: entry.entityLabel,
        outcome: entry.outcome,
        ip: entry.ipAddress,
        agent: entry.userAgent,
      })),
    );
    recordAudit({
      actorId: actor?.id ?? 'system',
      action: 'Exported the audit trail',
      entity: 'Report',
      entityId: 'audit-trail',
      entityLabel: 'Audit trail export',
      metadata: { rows: filtered.length, windowDays: days },
    });
    notify({
      variant: 'success',
      title: 'Audit trail exported',
      description: `${formatNumber(filtered.length)} entries written to CSV.`,
    });
  };

  const columns: Column<AuditLogEntry>[] = [
    {
      key: 'at',
      header: 'When',
      width: '11rem',
      cell: (entry) => (
        <span className="tnum text-ink-700" title={formatDateTime(entry.at)}>
          {formatTimestamp(entry.at)}
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'User',
      width: '13rem',
      cell: (entry) => {
        const user = userById.get(entry.actorId);
        return user ? (
          <div className="flex items-center gap-2">
            <Avatar user={user} size="xs" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink-900">{user.fullName}</p>
              <p className="truncate text-[11px] text-ink-500">{user.title}</p>
            </div>
          </div>
        ) : (
          <span className="text-ink-500">System</span>
        );
      },
    },
    {
      key: 'action',
      header: 'Action',
      cell: (entry) => (
        // The record it touched is the longest text in the row and the first to
        // be clipped, so both lines carry their full value as a tooltip.
        <div className="min-w-0">
          <p className="truncate text-[13px] text-ink-900" title={entry.action}>
            {entry.action}
          </p>
          <p className="truncate text-[11px] text-ink-500" title={`${entry.entity} · ${entry.entityLabel}`}>
            {entry.entity} · {entry.entityLabel}
          </p>
        </div>
      ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      width: '6.75rem',
      hideBelow: 'sm',
      cell: (entry) => (
        <Badge tone={entry.outcome === 'success' ? 'brand' : 'danger'} size="sm">
          {entry.outcome === 'success' ? 'Success' : 'Failed'}
        </Badge>
      ),
    },
    {
      key: 'ip',
      header: 'IP address',
      width: '8.5rem',
      hideBelow: 'sm',
      cell: (entry) => (
        <span className="tnum text-[12px] whitespace-nowrap text-ink-700" title={entry.userAgent}>
          {entry.ipAddress}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Entries in view"
          value={formatNumber(filtered.length)}
          hint={`${formatNumber(auditLog.length)} held in total`}
          icon={<ClipboardList className="size-4" aria-hidden />}
        />
        <StatCard
          label="Failed attempts"
          value={failures}
          tone={failures > 0 ? 'danger' : 'default'}
          hint="Sign-in refusals and denied actions"
          icon={<ShieldAlert className="size-4" aria-hidden />}
        />
        <StatCard
          label="Distinct addresses"
          value={addresses}
          hint="Sources seen in this window"
          icon={<Globe className="size-4" aria-hidden />}
        />
      </div>

      <Card flush>
        <CardHeader
          title="Audit trail"
          hint="Every action is recorded with the user, the timestamp and the originating IP address. Entries cannot be edited or removed."
          actions={
            canExport && (
              <Button size="sm" onClick={onExport} icon={<Download className="size-4" aria-hidden />}>
                Export CSV
              </Button>
            )
          }
        />
        <CardBody className="border-t border-ink-200">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search action, record, user or IP"
                sizing="sm"
                aria-label="Search the audit trail"
              />
            </div>
            <div className="w-44">
              <Field label="Window">
                {(props) => (
                  <Select
                    value={days}
                    onChange={(event) => {
                      setDays(Number(event.target.value));
                      setPage(1);
                    }}
                    sizing="sm"
                    {...props}
                  >
                    {RANGES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div className="w-36">
              <Field label="Outcome">
                {(props) => (
                  <Select
                    value={outcome}
                    onChange={(event) => {
                      setOutcome(event.target.value);
                      setPage(1);
                    }}
                    sizing="sm"
                    {...props}
                  >
                    <option value="">All</option>
                    <option value="success">Success</option>
                    <option value="failure">Failed</option>
                  </Select>
                )}
              </Field>
            </div>
            <FilterMenu
              label="Entity"
              selected={entities}
              onChange={(values) => {
                setEntities(values);
                setPage(1);
              }}
              options={ENTITIES.map((entity) => ({
                value: entity,
                label: entity === 'CourtDate' ? 'Court sitting' : entity,
                count: auditLog.filter((entry) => entry.entity === entity).length,
              }))}
            />
            <FilterMenu
              label="User"
              searchable
              selected={actors}
              onChange={(values) => {
                setActors(values);
                setPage(1);
              }}
              options={users
                .filter((user) => auditLog.some((entry) => entry.actorId === user.id))
                .map((user) => ({
                  value: user.id,
                  label: user.fullName,
                  count: auditLog.filter((entry) => entry.actorId === user.id).length,
                }))}
            />
          </div>
        </CardBody>

        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(entry) => entry.id}
          dense
          layout="fixed"
          caption="Audit trail"
          empty={
            <EmptyState
              icon={<ClipboardList className="size-5" aria-hidden />}
              title="Nothing recorded in this window"
              description="Widen the window or clear the filters."
              compact
            />
          }
        />

        {filtered.length > 0 && (
          <div className="border-t border-ink-200 px-3 py-2">
            <Pagination
              page={current}
              pageCount={pageCount}
              pageSize={pageSize}
              total={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              label="audit entries"
            />
          </div>
        )}
      </Card>
    </div>
  );
}
