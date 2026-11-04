import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { authedQuery } from './lib/functions';
import { visibleCaseIds } from './cases';
import { loadCourt, loadCaseType, loadUser } from './lib/rows';
import { REPORT_DEFINITIONS, type ReportColumn } from './shared/reports';
import { reportIdValidator } from './shared/enums';
import type { CaseStatus } from './shared/enums';

/**
 * HYPREP LCMS - the six standard reports (TOR §20-22) plus the ad-hoc builder
 * backing query.
 *
 * The plan's rule holds here: `src/lib/format.ts` (Intl 'en-NG') never crosses
 * to the server. The query computes the raw values (counts, ISO dates, byte
 * totals, booleans) over the *visible* register - the same `caseMembers`
 * boundary as the register and dashboard - and the client formats each cell
 * for display and CSV. The shared `REPORT_DEFINITIONS` keep the columns that
 * drive both the on-screen table and the export.
 */

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export type ReportCell = string | number;
export type ReportRow = Record<string, ReportCell>;

const reportColumn = v.object({
  key: v.string(),
  label: v.string(),
  align: v.optional(v.union(v.literal('left'), v.literal('right'), v.literal('center'))),
});

const reportResult = v.object({
  id: reportIdValidator,
  columns: v.array(reportColumn),
  rows: v.array(v.object({})),
  caption: v.string(),
});

const runArgs = v.object({
  id: reportIdValidator,
  windowDays: v.optional(v.number()),
  ownerId: v.optional(v.union(v.id('users'), v.null())),
});

const CLOSED: CaseStatus[] = ['Judgment Delivered', 'Concluded', 'Closed', 'Archived'];
const OPEN: CaseStatus[] = ['Draft', 'Filed', 'Pending', 'Adjourned', 'Heard'];

const MONTH_MS = 30.44 * 86_400_000;

function ageDays(value: string | null | undefined, now: Date): number {
  if (!value) return 0;
  const start = Date.parse(value);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((now.getTime() - start) / 86_400_000));
}

function ageLabel(value: string, now: Date): string {
  const days = ageDays(value, now);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  const years = Math.floor(days / 365);
  const months = Math.round((days % 365) / 30);
  return months > 0 ? `${years}y ${months}mo` : `${years}y`;
}

function ageBucket(value: string, now: Date): string {
  const start = Date.parse(value);
  if (Number.isNaN(start)) return '0-3 mo';
  const months = (now.getTime() - start) / MONTH_MS;
  if (months < 3) return '0-3 mo';
  if (months < 6) return '3-6 mo';
  if (months < 12) return '6-12 mo';
  if (months < 36) return '1-3 yrs';
  if (months < 60) return '3-5 yrs';
  return '5+ yrs';
}

function daysUntil(iso: string, now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(iso);
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((targetDay.getTime() - start.getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** Runs one of the six TOR reports over the caller's visible register. */
export const run = authedQuery({
  permission: 'report.view',
  args: runArgs,
  returns: reportResult,
  handler: async (ctx, args) => {
    const actor = ctx.actor;
    const now = new Date();
    const definition = REPORT_DEFINITIONS.find((report) => report.id === args.id)!;
    const windowDays = args.windowDays ?? 30;
    const ownerId = args.ownerId ?? null;

    const ids = await visibleCaseIds(ctx, actor.access);
    const cases: Doc<'cases'>[] = [];
    for (const id of ids) {
      const record = await ctx.db.get(id);
      if (record !== null) cases.push(record);
    }
    const scoped = ownerId ? cases.filter((record) => record.matterOwnerId === ownerId) : cases;

    const courtById = new Map<Id<'courts'>, Doc<'courts'>>();
    const typeById = new Map<Id<'caseTypes'>, Doc<'caseTypes'>>();
    const userById = new Map<Id<'users'>, Doc<'users'>>();
    for (const record of scoped) {
      if (!courtById.has(record.courtId)) {
        const court = await loadCourt(ctx, record.courtId);
        if (court) courtById.set(record.courtId, court);
      }
      if (!typeById.has(record.caseTypeId)) {
        const type = await loadCaseType(ctx, record.caseTypeId);
        if (type) typeById.set(record.caseTypeId, type);
      }
      if (!userById.has(record.matterOwnerId)) {
        const owner = await loadUser(ctx, record.matterOwnerId);
        if (owner) userById.set(record.matterOwnerId, owner);
      }
    }

    const scopedIds = new Set(scoped.map((record) => record._id));
    const allHearings: Doc<'courtDates'>[] = [];
    const allTasks: Doc<'tasks'>[] = [];
    for (const record of scoped) {
      allHearings.push(
        ...(await ctx.db
          .query('courtDates')
          .withIndex('by_case', (q) => q.eq('caseId', record._id))
          .collect()),
      );
      allTasks.push(
        ...(await ctx.db
          .query('tasks')
          .withIndex('by_case', (q) => q.eq('caseId', record._id))
          .collect()),
      );
    }
    const allDocuments: Doc<'documents'>[] = [];
    for (const record of scoped) {
      allDocuments.push(
        ...(await ctx.db
          .query('documents')
          .withIndex('by_case', (q) => q.eq('caseId', record._id))
          .collect()),
      );
    }

    let rows: ReportRow[] = [];
    let caption = '';

    switch (args.id) {
      case 'caseload-by-status': {
        const total = scoped.length || 1;
        const grouped = new Map<string, { count: number; exposure: number }>();
        scoped.forEach((record) => {
          const entry = grouped.get(record.status) ?? { count: 0, exposure: 0 };
          entry.count += 1;
          entry.exposure += record.claimValue ?? 0;
          grouped.set(record.status, entry);
        });
        caption = `${scoped.length} matters across ${grouped.size} statuses.`;
        rows = [...grouped.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .map(([status, entry]) => ({
            status,
            count: entry.count,
            share: Math.round((entry.count / total) * 1000) / 10,
            exposure: entry.exposure,
          }));
        break;
      }

      case 'upcoming-hearings': {
        const sittings = allHearings
          .filter((sitting) => {
            if (sitting.outcome || !scopedIds.has(sitting.caseId)) return false;
            const days = daysUntil(sitting.startsAt, now);
            return days >= 0 && days <= windowDays;
          })
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        caption = `${sittings.length} sittings diarised in the next ${windowDays} days.`;
        rows = sittings.map((sitting) => {
          const record = scoped.find((item) => item._id === sitting.caseId);
          return {
            date: sitting.startsAt,
            time: sitting.startsAt,
            caseId: record?.caseId ?? '—',
            title: record?.title ?? '—',
            court: courtById.get(sitting.courtId)?.name ?? '—',
            purpose: sitting.purpose,
            owner: record ? userById.get(record.matterOwnerId)?.fullName ?? '—' : '—',
          };
        });
        break;
      }

      case 'age-of-matters': {
        const open = scoped
          .filter((record) => OPEN.includes(record.status))
          .sort(
            (a, b) =>
              ageDays(b.filingDate ?? b.createdAt, now) - ageDays(a.filingDate ?? a.createdAt, now),
          );
        caption = `${open.length} open matters. Oldest: ${open[0] ? ageLabel(open[0].filingDate ?? open[0].createdAt, now) : '—'}.`;
        rows = open.map((record) => ({
          caseId: record.caseId,
          title: record.title,
          status: record.status,
          filingDate: record.filingDate ?? 'Not yet filed',
          age: ageDays(record.filingDate ?? record.createdAt, now),
          bucket: ageBucket(record.filingDate ?? record.createdAt, now),
        }));
        break;
      }

      case 'workload-by-lawyer': {
        const fileHolders = [...userById.values()].filter((user) =>
          ['SUPER_ADMIN', 'ADMIN', 'LEGAL_STAFF'].includes(user.role),
        );
        const workload = fileHolders
          .map((user) => {
            const owned = scoped.filter(
              (record) =>
                record.matterOwnerId === user._id || record.assigneeIds.includes(user._id),
            );
            const ownedIds = new Set(owned.map((record) => record._id));
            const userTasks = allTasks.filter(
              (task) => task.ownerId === user._id && task.status !== 'Completed',
            );
            return {
              lawyer: user.fullName,
              title: user.title,
              openCases: owned.filter((record) => OPEN.includes(record.status)).length,
              hearings30: allHearings.filter(
                (sitting) =>
                  ownedIds.has(sitting.caseId) &&
                  !sitting.outcome &&
                  daysUntil(sitting.startsAt, now) >= 0 &&
                  daysUntil(sitting.startsAt, now) <= 30,
              ).length,
              openTasks: userTasks.length,
              overdueTasks: userTasks.filter((task) => daysUntil(task.dueDate, now) < 0).length,
              exposure: owned.reduce((sum, record) => sum + (record.claimValue ?? 0), 0),
            };
          })
          .sort((a, b) => b.openCases - a.openCases);
        caption = `${workload.length} fee earners carrying ${scoped.length} matters between them.`;
        rows = workload.map((entry) => ({
          ...entry,
          exposure: entry.exposure,
        }));
        break;
      }

      case 'concluded-matters': {
        const concluded = scoped
          .filter((record) => CLOSED.includes(record.status))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        caption = `${concluded.length} matters concluded, closed or archived.`;
        rows = concluded.map((record) => ({
          caseId: record.caseId,
          title: record.title,
          court: courtById.get(record.courtId)?.name ?? '—',
          status: record.status,
          outcome: 'Not recorded',
          duration: ageDays(record.filingDate ?? record.createdAt, now),
          owner: userById.get(record.matterOwnerId)?.fullName ?? '—',
        }));
        break;
      }

      case 'document-inventory':
      default: {
        const typeByIdMap = new Map<Id<'documentTypes'>, Doc<'documentTypes'>>();
        for (const document of allDocuments) {
          if (!typeByIdMap.has(document.documentTypeId)) {
            const type = await ctx.db.get(document.documentTypeId);
            if (type) typeByIdMap.set(document.documentTypeId, type);
          }
        }
        const totalBytes = allDocuments.reduce(
          (sum, document) =>
            sum + document.versions.reduce((inner, version) => inner + version.sizeBytes, 0),
          0,
        );
        caption = `${allDocuments.length} documents · ${totalBytes} bytes stored.`;
        rows = allDocuments
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((document) => {
            const latest = document.versions[document.versions.length - 1]!;
            return {
              name: document.name,
              caseId: scoped.find((record) => record._id === document.caseId)?.caseId ?? '—',
              type: typeByIdMap.get(document.documentTypeId)?.name ?? '—',
              versions: document.versions.length,
              size: latest.sizeBytes,
              confidential: document.confidential ? 'Yes' : 'No',
              uploaded: latest.uploadedAt,
            };
          });
        break;
      }
    }

    return {
      id: args.id,
      columns: definition.columns as ReportColumn[],
      rows,
      caption,
    };
  },
});
