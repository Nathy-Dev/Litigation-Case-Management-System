import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { authedQuery } from './lib/functions';
import { visibleCaseIds } from './cases';
import { loadCourt, loadCaseType, loadUser } from './lib/rows';
import { caseStatusValidator } from './shared/enums';
import type { CaseStatus } from './shared/enums';

/**
 * HYPREP LCMS - the dashboard summary.
 *
 * Every figure here is an aggregate over the whole *visible* register. That is
 * exactly what cannot be shipped to the client: the register can be paginated
 * and filtered, but a card reading "1,204 matters" has to count all of them.
 * This query applies the same `caseMembers` visibility as the register, then
 * does the arithmetic server-side over the visible set, and returns the same
 * `DashboardMetrics` shape `src/lib/selectors/dashboard.ts` built.
 *
 * The frontend still renders charts and panels; it no longer does the counting.
 */

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

const hearingSummary = v.object({
  id: v.id('courtDates'),
  caseId: v.id('cases'),
  caseNumber: v.string(),
  startsAt: v.string(),
  purpose: v.string(),
  judge: v.string(),
  courtRoom: v.string(),
});

const workloadRow = v.object({
  userId: v.id('users'),
  fullName: v.string(),
  open: v.number(),
  hearings: v.number(),
  overdue: v.number(),
});

const trendRow = v.object({
  month: v.string(),
  filed: v.number(),
  concluded: v.number(),
});

const dashboardMetrics = v.object({
  totalMatters: v.number(),
  activeMatters: v.number(),
  concludedMatters: v.number(),
  confidentialMatters: v.number(),
  hearingsToday: v.array(hearingSummary),
  hearingsThisWeek: v.array(hearingSummary),
  hearingsNext30: v.array(hearingSummary),
  openTasks: v.number(),
  overdueTasks: v.number(),
  tasksDueToday: v.number(),
  documentCount: v.number(),
  totalExposure: v.number(),
  byStatus: v.array(v.object({ status: caseStatusValidator, count: v.number() })),
  byPriority: v.array(v.object({ priority: v.string(), count: v.number() })),
  byAgeBucket: v.array(v.object({ bucket: v.string(), count: v.number() })),
  byCourtTier: v.array(v.object({ tier: v.string(), count: v.number() })),
  workload: v.array(workloadRow),
  filingTrend: v.array(trendRow),
});

const myWorkResult = v.object({
  myMatters: v.number(),
  myHearings: v.array(hearingSummary),
  myTasks: v.array(
    v.object({
      id: v.id('tasks'),
      title: v.string(),
      dueDate: v.string(),
      priority: v.string(),
      status: v.string(),
      caseId: v.union(v.id('cases'), v.null()),
    }),
  ),
  myOverdue: v.array(
    v.object({
      id: v.id('tasks'),
      title: v.string(),
      dueDate: v.string(),
    }),
  ),
  unread: v.number(),
});

const ACTIVE_STATUSES: CaseStatus[] = ['Filed', 'Pending', 'Adjourned', 'Heard'];
const CLOSED_STATUSES: CaseStatus[] = ['Judgment Delivered', 'Concluded', 'Closed', 'Archived'];
const AGE_BUCKETS = [
  '0-3 mo',
  '3-6 mo',
  '6-12 mo',
  '1-3 yrs',
  '3-5 yrs',
  '5+ yrs',
] as const;

function ageBucket(value: string | null, now: Date): string {
  const start = value ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(start)) return '0-3 mo';
  const months = (now.getTime() - start) / (30.44 * 86_400_000);
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

function monthKey(date: Date): string {
  return date.toLocaleDateString('en-NG', { month: 'short', year: '2-digit' });
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** Aggregates the whole visible register into the dashboard metrics. */
export const summary = authedQuery({
  permission: 'case.view.all',
  args: {},
  returns: v.object({ metrics: dashboardMetrics, myWork: myWorkResult }),
  handler: async (ctx) => {
    const actor = ctx.actor;
    const now = new Date();

    const ids = await visibleCaseIds(ctx, actor.access);
    const cases: Doc<'cases'>[] = [];
    for (const id of ids) {
      const record = await ctx.db.get(id);
      if (record !== null) cases.push(record);
    }

    // One pass of reference lookups.
    const courtById = new Map<Id<'courts'>, Doc<'courts'>>();
    const typeById = new Map<Id<'caseTypes'>, Doc<'caseTypes'>>();
    const userById = new Map<Id<'users'>, Doc<'users'>>();
    for (const record of cases) {
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

    // Children: hearings, tasks, documents for the visible set, one index scan each.
    const hearingsByCase = new Map<Id<'cases'>, Doc<'courtDates'>[]>();
    const allHearings: Doc<'courtDates'>[] = [];
    for (const record of cases) {
      const sittings = await ctx.db
        .query('courtDates')
        .withIndex('by_case', (q) => q.eq('caseId', record._id))
        .collect();
      hearingsByCase.set(record._id, sittings);
      allHearings.push(...sittings);
    }

    const tasksByCase = new Map<Id<'cases'>, Doc<'tasks'>[]>();
    let allTasks: Doc<'tasks'>[] = [];
    for (const record of cases) {
      const tasks = await ctx.db
        .query('tasks')
        .withIndex('by_case', (q) => q.eq('caseId', record._id))
        .collect();
      tasksByCase.set(record._id, tasks);
      allTasks.push(...tasks);
    }
    // Standalone tasks (the Legal Unit's own work) are visible to those who can
    // create tasks - the same rule as the task board.
    const canSeeUnitTasks = actor.can('task.create');
    if (canSeeUnitTasks) {
      const standalone = await ctx.db
        .query('tasks')
        .withIndex('by_case', (q) => q.eq('caseId', null))
        .collect();
      allTasks = allTasks.concat(standalone);
    }

    let documentCount = 0;
    for (const record of cases) {
      const docs = await ctx.db
        .query('documents')
        .withIndex('by_case', (q) => q.eq('caseId', record._id))
        .collect();
      documentCount += docs.length;
    }

    const statusCounts = new Map<CaseStatus, number>();
    const priorityCounts = new Map<string, number>();
    const ageCounts = new Map<string, number>();
    const tierCounts = new Map<string, number>();
    for (const record of cases) {
      statusCounts.set(record.status, (statusCounts.get(record.status) ?? 0) + 1);
      priorityCounts.set(record.priority, (priorityCounts.get(record.priority) ?? 0) + 1);
      const bucket = ageBucket(record.filingDate ?? record.createdAt, now);
      ageCounts.set(bucket, (ageCounts.get(bucket) ?? 0) + 1);
      const court = courtById.get(record.courtId);
      tierCounts.set(String(court?.tier ?? '—'), (tierCounts.get(String(court?.tier ?? '—')) ?? 0) + 1);
    }

    const trend = new Map<string, { filed: number; concluded: number }>();
    for (let i = 11; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      trend.set(monthKey(date), { filed: 0, concluded: 0 });
    }
    for (const record of cases) {
      if (record.filingDate) {
        const key = monthKey(new Date(record.filingDate));
        const entry = trend.get(key);
        if (entry) entry.filed += 1;
      }
      if (CLOSED_STATUSES.includes(record.status)) {
        const key = monthKey(new Date(record.updatedAt));
        const entry = trend.get(key);
        if (entry) entry.concluded += 1;
      }
    }

    const openTasks = allTasks.filter(
      (task) => task.status !== 'Completed' && task.status !== 'Cancelled',
    );

    // Workload: file holders (the Legal Unit), open matters, hearings in 30d, overdue tasks.
    const fileHolders = [...userById.values()].filter((user) =>
      ['SUPER_ADMIN', 'ADMIN', 'LEGAL_STAFF'].includes(user.role),
    );
    const workload = fileHolders
      .map((user) => {
        const owned = cases.filter(
          (record) =>
            record.matterOwnerId === user._id || record.assigneeIds.includes(user._id),
        );
        const ownedIds = new Set(owned.map((record) => record._id));
        const userTasks = allTasks.filter(
          (task) => task.ownerId === user._id && task.status !== 'Completed',
        );
        return {
          userId: user._id,
          fullName: user.fullName,
          open: owned.filter((record) => ACTIVE_STATUSES.includes(record.status)).length,
          hearings: allHearings.filter(
            (sitting) =>
              ownedIds.has(sitting.caseId) &&
              !sitting.outcome &&
              daysUntil(sitting.startsAt, now) >= 0 &&
              daysUntil(sitting.startsAt, now) <= 30,
          ).length,
          overdue: userTasks.filter((task) => daysUntil(task.dueDate, now) < 0).length,
        };
      })
      .sort((a, b) => b.open - a.open);

    const visibleHearings = allHearings.filter((sitting) => !sitting.outcome);
    const hearingsToday = visibleHearings
      .filter((sitting) => daysUntil(sitting.startsAt, now) === 0)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const hearingsThisWeek = visibleHearings
      .filter((sitting) => {
        const days = daysUntil(sitting.startsAt, now);
        return days >= 0 && days <= 7;
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const hearingsNext30 = visibleHearings
      .filter((sitting) => {
        const days = daysUntil(sitting.startsAt, now);
        return days >= 0 && days <= 30;
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    const summaryHearing = (sitting: Doc<'courtDates'>) => ({
      id: sitting._id,
      caseId: sitting.caseId,
      caseNumber: cases.find((record) => record._id === sitting.caseId)?.caseId ?? '',
      startsAt: sitting.startsAt,
      purpose: sitting.purpose,
      judge: sitting.judge,
      courtRoom: sitting.courtRoom,
    });

    const metrics = {
      totalMatters: cases.length,
      activeMatters: cases.filter((record) => ACTIVE_STATUSES.includes(record.status)).length,
      concludedMatters: cases.filter((record) => CLOSED_STATUSES.includes(record.status)).length,
      confidentialMatters: cases.filter((record) => record.confidential).length,
      hearingsToday: hearingsToday.map(summaryHearing),
      hearingsThisWeek: hearingsThisWeek.map(summaryHearing),
      hearingsNext30: hearingsNext30.map(summaryHearing),
      openTasks: openTasks.length,
      overdueTasks: openTasks.filter((task) => daysUntil(task.dueDate, now) < 0).length,
      tasksDueToday: openTasks.filter((task) => daysUntil(task.dueDate, now) === 0).length,
      documentCount,
      totalExposure: cases.reduce((sum, record) => sum + (record.claimValue ?? 0), 0),
      byStatus: (
        ['Draft', 'Filed', 'Pending', 'Adjourned', 'Heard', 'Judgment Delivered', 'Concluded', 'Closed', 'Archived'] as CaseStatus[]
      ).map((status) => ({ status, count: statusCounts.get(status) ?? 0 })),
      byPriority: ['Critical', 'High', 'Medium', 'Low'].map((priority) => ({
        priority,
        count: priorityCounts.get(priority) ?? 0,
      })),
      byAgeBucket: AGE_BUCKETS.map((bucket) => ({ bucket, count: ageCounts.get(bucket) ?? 0 })),
      byCourtTier: [...tierCounts.entries()]
        .map(([tier, count]) => ({ tier, count }))
        .sort((a, b) => b.count - a.count),
      workload,
      filingTrend: [...trend.entries()].map(([month, value]) => ({ month, ...value })),
    };

    // "My work" - the personal slice.
    const userId = actor.user._id;
    const myMatters = cases.filter(
      (record) =>
        record.matterOwnerId === userId ||
        record.assigneeIds.includes(userId) ||
        record.externalCounselIds.includes(userId) ||
        record.stakeholderIds.includes(userId),
    );
    const myIds = new Set(myMatters.map((record) => record._id));
    const myTasks = allTasks
      .filter((task) => task.ownerId === userId && task.status !== 'Completed')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const myHearings = allHearings
      .filter(
        (sitting) =>
          !sitting.outcome &&
          daysUntil(sitting.startsAt, now) >= 0 &&
          (sitting.attendeeIds.includes(userId) || myIds.has(sitting.caseId)),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const unread = await ctx.db
      .query('notifications')
      .withIndex('by_user_read', (q) => q.eq('userId', userId).eq('read', false))
      .collect();

    return {
      metrics,
      myWork: {
        myMatters: myMatters.length,
        myHearings: myHearings.map(summaryHearing),
        myTasks: myTasks.map((task) => ({
          id: task._id,
          title: task.title,
          dueDate: task.dueDate,
          priority: task.priority,
          status: task.status,
          caseId: task.caseId,
        })),
        myOverdue: myTasks
          .filter((task) => daysUntil(task.dueDate, now) < 0)
          .map((task) => ({ id: task._id, title: task.title, dueDate: task.dueDate })),
        unread: unread.length,
      },
    };
  },
});
