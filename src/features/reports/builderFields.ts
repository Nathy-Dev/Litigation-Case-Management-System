import type { ReportColumn } from '@/types';
import type { Dataset } from '@/lib/selectors/types';
import type { CaseRow } from '@/lib/selectors/cases';
import type { ReportCell, ReportRow } from '@/lib/selectors/reports';
import {
  ageInDays,
  formatBytes,
  formatDate,
  formatHearingSlot,
  formatNaira,
  formatNumber,
} from '@/lib/format';

export type BuilderEntity = 'cases' | 'hearings' | 'documents' | 'tasks';

export interface BuilderField {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Fields offered as the grouping key must be low-cardinality. */
  groupable?: boolean;
}

export const ENTITIES: { value: BuilderEntity; label: string; description: string }[] = [
  { value: 'cases', label: 'Matters', description: 'One row per matter in the register.' },
  { value: 'hearings', label: 'Court sittings', description: 'One row per listed sitting.' },
  { value: 'documents', label: 'Documents', description: 'One row per document held.' },
  { value: 'tasks', label: 'Tasks', description: 'One row per task raised.' },
];

export const FIELDS: Record<BuilderEntity, BuilderField[]> = {
  cases: [
    { key: 'caseId', label: 'Case ID' },
    { key: 'title', label: 'Title' },
    { key: 'suitNumber', label: 'Suit number' },
    { key: 'parties', label: 'Parties' },
    { key: 'court', label: 'Court', groupable: true },
    { key: 'caseType', label: 'Case type', groupable: true },
    { key: 'status', label: 'Status', groupable: true },
    { key: 'priority', label: 'Priority', groupable: true },
    { key: 'owner', label: 'Matter owner', groupable: true },
    { key: 'filingDate', label: 'Filed' },
    { key: 'age', label: 'Age (days)', align: 'right' },
    { key: 'nextHearing', label: 'Next sitting' },
    { key: 'claimValue', label: 'Sum claimed', align: 'right' },
    { key: 'documents', label: 'Documents', align: 'right' },
    { key: 'openTasks', label: 'Open tasks', align: 'right' },
    { key: 'tags', label: 'Tags' },
    { key: 'confidential', label: 'Confidential', groupable: true },
  ],
  hearings: [
    { key: 'caseId', label: 'Case ID' },
    { key: 'title', label: 'Matter' },
    { key: 'slot', label: 'Sitting' },
    { key: 'court', label: 'Court', groupable: true },
    { key: 'courtRoom', label: 'Court room' },
    { key: 'judge', label: 'Presiding' },
    { key: 'purpose', label: 'Purpose', groupable: true },
    { key: 'outcome', label: 'Outcome', groupable: true },
    { key: 'owner', label: 'Matter owner', groupable: true },
    { key: 'attendees', label: 'Appearing', align: 'right' },
  ],
  documents: [
    { key: 'name', label: 'Document' },
    { key: 'caseId', label: 'Case ID' },
    { key: 'type', label: 'Document type', groupable: true },
    { key: 'format', label: 'Format', groupable: true },
    { key: 'version', label: 'Version', align: 'right' },
    { key: 'size', label: 'Size', align: 'right' },
    { key: 'author', label: 'Filed by', groupable: true },
    { key: 'uploadedAt', label: 'Filed on' },
    { key: 'confidential', label: 'Confidential', groupable: true },
    { key: 'ocrStatus', label: 'OCR', groupable: true },
  ],
  tasks: [
    { key: 'title', label: 'Task' },
    { key: 'caseId', label: 'Case ID' },
    { key: 'owner', label: 'Owner', groupable: true },
    { key: 'status', label: 'Status', groupable: true },
    { key: 'priority', label: 'Priority', groupable: true },
    { key: 'dueDate', label: 'Due' },
    { key: 'overdue', label: 'Overdue', groupable: true },
    { key: 'checklist', label: 'Checklist done' },
  ],
};

export const DEFAULT_COLUMNS: Record<BuilderEntity, string[]> = {
  cases: ['caseId', 'title', 'court', 'status', 'owner', 'nextHearing'],
  hearings: ['caseId', 'slot', 'court', 'purpose', 'outcome'],
  documents: ['name', 'caseId', 'type', 'version', 'size', 'uploadedAt'],
  tasks: ['title', 'caseId', 'owner', 'status', 'dueDate'],
};

export function columnsFor(entity: BuilderEntity, keys: string[]): ReportColumn[] {
  return keys
    .map((key) => FIELDS[entity].find((field) => field.key === key))
    .filter((field): field is BuilderField => Boolean(field))
    .map((field) => ({ key: field.key, label: field.label, align: field.align ?? 'left' }));
}

/** Every builder row is a flat record so the table, CSV and PDF all reuse it. */
export function buildRows(
  entity: BuilderEntity,
  data: Dataset,
  rows: CaseRow[],
): ReportRow[] {
  const nameOf = (id: string | null) =>
    data.users.find((user) => user.id === id)?.fullName ?? '—';
  const rowsById = new Map(rows.map((row) => [row.record.id, row]));

  if (entity === 'cases') {
    return rows.map((row) => ({
      caseId: row.record.caseId,
      title: row.record.title,
      suitNumber: row.record.suitNumber ?? '—',
      parties: row.partiesLabel,
      court: row.courtName,
      caseType: row.caseTypeName,
      status: row.record.status,
      priority: row.record.priority,
      owner: row.owner?.fullName ?? '—',
      filingDate: row.record.filingDate ? formatDate(row.record.filingDate) : '—',
      age: row.ageDays,
      nextHearing: row.nextHearing ? formatHearingSlot(row.nextHearing.startsAt) : '—',
      claimValue: row.record.claimValue === null ? '—' : formatNaira(row.record.claimValue),
      documents: row.documentCount,
      openTasks: row.openTasks,
      tags: row.record.tags.join(', ') || '—',
      confidential: row.record.confidential ? 'Yes' : 'No',
    }));
  }

  if (entity === 'hearings') {
    return data.courtDates
      .filter((sitting) => rowsById.has(sitting.caseId))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((sitting) => {
        const row = rowsById.get(sitting.caseId)!;
        return {
          caseId: row.record.caseId,
          title: row.record.title,
          slot: formatHearingSlot(sitting.startsAt, sitting.durationMinutes),
          court: row.courtName,
          courtRoom: sitting.courtRoom,
          judge: sitting.judge,
          purpose: sitting.purpose,
          outcome: sitting.outcome ?? 'Not yet recorded',
          owner: row.owner?.fullName ?? '—',
          attendees: sitting.attendeeIds.length,
        } satisfies Record<string, ReportCell>;
      });
  }

  if (entity === 'documents') {
    return data.documents
      .filter((doc) => rowsById.has(doc.caseId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((doc) => {
        const current = doc.versions.find((version) => version.version === doc.currentVersion);
        return {
          name: doc.name,
          caseId: rowsById.get(doc.caseId)!.record.caseId,
          type: data.documentTypes.find((type) => type.id === doc.documentTypeId)?.name ?? '—',
          format: doc.format.toUpperCase(),
          version: `v${doc.currentVersion}`,
          size: formatBytes(current?.sizeBytes ?? 0),
          author: nameOf(doc.authorId),
          uploadedAt: formatDate(current?.uploadedAt ?? doc.createdAt),
          confidential: doc.confidential ? 'Yes' : 'No',
          ocrStatus: doc.ocrStatus === 'not_applicable' ? '—' : doc.ocrStatus,
        } satisfies Record<string, ReportCell>;
      });
  }

  return data.tasks
    .filter((task) => task.caseId === null || rowsById.has(task.caseId))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((task) => {
      const done = task.checklist.filter((item) => item.done).length;
      const openStatus = task.status !== 'Completed' && task.status !== 'Cancelled';
      return {
        title: task.title,
        caseId: task.caseId ? (rowsById.get(task.caseId)?.record.caseId ?? '—') : 'Not on a matter',
        owner: nameOf(task.ownerId),
        status: task.status,
        priority: task.priority,
        dueDate: formatDate(task.dueDate),
        overdue: openStatus && ageInDays(task.dueDate) > 0 ? 'Yes' : 'No',
        checklist: task.checklist.length ? `${done}/${task.checklist.length}` : '—',
      } satisfies Record<string, ReportCell>;
    });
}

/** Group rows by one column and count them — the builder's only aggregation. */
export function groupRows(rows: ReportRow[], key: string, label: string): {
  columns: ReportColumn[];
  rows: ReportRow[];
} {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const value = String(row[key] ?? '—');
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  const total = rows.length || 1;
  return {
    columns: [
      { key: 'group', label, align: 'left' },
      { key: 'count', label: 'Rows', align: 'right' },
      { key: 'share', label: 'Share', align: 'right' },
    ],
    rows: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([group, count]) => ({
        group,
        count: formatNumber(count),
        share: `${Math.round((count / total) * 100)}%`,
      })),
  };
}
