import type { ReportColumn, ReportId } from '@/types';
import type { Dataset } from './types';
import type { CaseRow } from './cases';
import { buildWorkload } from './dashboard';
import {
  ageBucket,
  daysUntil,
  formatAge,
  formatBytes,
  formatDate,
  formatNaira,
  formatPercent,
  formatTime,
} from '@/lib/format';

export type ReportCell = string | number;
export type ReportRow = Record<string, ReportCell>;

export interface ReportResult {
  id: ReportId;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Short summary line shown under the report title. */
  caption: string;
}

export interface ReportOptions {
  /** Window for the upcoming-hearings report. */
  windowDays?: number;
  /** Restrict to a single matter owner. */
  ownerId?: string | null;
}

const CLOSED = ['Judgment Delivered', 'Concluded', 'Closed', 'Archived'];
const OPEN = ['Draft', 'Filed', 'Pending', 'Adjourned', 'Heard'];

/**
 * The six reports named in the TOR. Each returns table-ready rows so the same
 * output drives the on-screen table, the CSV export and the print/PDF view.
 */
export function runReport(
  id: ReportId,
  data: Dataset,
  rows: CaseRow[],
  options: ReportOptions = {},
): ReportResult {
  const definition = data.reports.find((report) => report.id === id)!;
  const scoped = options.ownerId
    ? rows.filter((row) => row.record.matterOwnerId === options.ownerId)
    : rows;

  switch (id) {
    case 'caseload-by-status': {
      const total = scoped.length || 1;
      const grouped = new Map<string, { count: number; exposure: number }>();
      scoped.forEach((row) => {
        const entry = grouped.get(row.record.status) ?? { count: 0, exposure: 0 };
        entry.count += 1;
        entry.exposure += row.record.claimValue ?? 0;
        grouped.set(row.record.status, entry);
      });

      return {
        id,
        columns: definition.columns,
        caption: `${scoped.length} matters across ${grouped.size} statuses.`,
        rows: [...grouped.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .map(([status, entry]) => ({
            status,
            count: entry.count,
            share: formatPercent(entry.count / total),
            exposure: entry.exposure ? formatNaira(entry.exposure) : '—',
          })),
      };
    }

    case 'upcoming-hearings': {
      const windowDays = options.windowDays ?? 30;
      const visible = new Set(scoped.map((row) => row.record.id));
      const rowById = new Map(scoped.map((row) => [row.record.id, row]));

      const sittings = data.courtDates
        .filter((sitting) => {
          if (sitting.outcome || !visible.has(sitting.caseId)) return false;
          const days = daysUntil(sitting.startsAt);
          return days >= 0 && days <= windowDays;
        })
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

      return {
        id,
        columns: definition.columns,
        caption: `${sittings.length} sittings diarised in the next ${windowDays} days.`,
        rows: sittings.map((sitting) => {
          const row = rowById.get(sitting.caseId);
          return {
            date: formatDate(sitting.startsAt),
            time: formatTime(sitting.startsAt),
            caseId: row?.record.caseId ?? '—',
            title: row?.record.title ?? '—',
            court: row?.courtName ?? '—',
            purpose: sitting.purpose,
            owner: row?.owner?.fullName ?? '—',
          };
        }),
      };
    }

    case 'age-of-matters': {
      const open = scoped
        .filter((row) => OPEN.includes(row.record.status))
        .sort((a, b) => b.ageDays - a.ageDays);

      return {
        id,
        columns: definition.columns,
        caption: `${open.length} open matters. Oldest: ${open[0] ? formatAge(open[0].record.filingDate ?? open[0].record.createdAt) : '—'}.`,
        rows: open.map((row) => ({
          caseId: row.record.caseId,
          title: row.record.title,
          status: row.record.status,
          filingDate: row.record.filingDate ? formatDate(row.record.filingDate) : 'Not yet filed',
          age: formatAge(row.record.filingDate ?? row.record.createdAt),
          bucket: ageBucket(row.record.filingDate ?? row.record.createdAt),
        })),
      };
    }

    case 'workload-by-lawyer': {
      const workload = buildWorkload(data, scoped);
      return {
        id,
        columns: definition.columns,
        caption: `${workload.length} fee earners carrying ${scoped.length} matters between them.`,
        rows: workload.map((entry) => {
          const owned = scoped.filter(
            (row) =>
              row.record.matterOwnerId === entry.user.id ||
              row.record.assigneeIds.includes(entry.user.id),
          );
          const openTasks = data.tasks.filter(
            (task) => task.ownerId === entry.user.id && task.status !== 'Completed',
          ).length;
          const exposure = owned.reduce((sum, row) => sum + (row.record.claimValue ?? 0), 0);

          return {
            lawyer: entry.user.fullName,
            title: entry.user.title,
            openCases: entry.open,
            hearings30: entry.hearings,
            openTasks,
            overdueTasks: entry.overdue,
            exposure: exposure ? formatNaira(exposure) : '—',
          };
        }),
      };
    }

    case 'concluded-matters': {
      const concluded = scoped
        .filter((row) => CLOSED.includes(row.record.status))
        .sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt));

      return {
        id,
        columns: definition.columns,
        caption: `${concluded.length} matters concluded, closed or archived.`,
        rows: concluded.map((row) => ({
          caseId: row.record.caseId,
          title: row.record.title,
          court: row.courtName,
          status: row.record.status,
          outcome: row.lastHearing?.outcome ?? 'Not recorded',
          duration: formatAge(row.record.filingDate ?? row.record.createdAt),
          owner: row.owner?.fullName ?? '—',
        })),
      };
    }

    case 'document-inventory':
    default: {
      const visible = new Set(scoped.map((row) => row.record.id));
      const caseById = new Map(scoped.map((row) => [row.record.id, row.record]));
      const typeById = new Map(data.documentTypes.map((type) => [type.id, type]));

      const documents = data.documents
        .filter((document) => visible.has(document.caseId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      const totalBytes = documents.reduce(
        (sum, document) =>
          sum + document.versions.reduce((inner, version) => inner + version.sizeBytes, 0),
        0,
      );

      return {
        id: 'document-inventory',
        columns: definition.columns,
        caption: `${documents.length} documents · ${formatBytes(totalBytes)} stored.`,
        rows: documents.map((document) => {
          const latest = document.versions[document.versions.length - 1]!;
          return {
            name: document.name,
            caseId: caseById.get(document.caseId)?.caseId ?? '—',
            type: typeById.get(document.documentTypeId)?.name ?? '—',
            versions: document.versions.length,
            size: formatBytes(latest.sizeBytes),
            confidential: document.confidential ? 'Yes' : 'No',
            uploaded: formatDate(latest.uploadedAt),
          };
        }),
      };
    }
  }
}
