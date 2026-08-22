import type { AppNotification, CaseStatus, CourtDate, Task, User } from '@/types';
import type { Dataset } from '@/mocks/generate';
import { visibleTasks, type CaseRow, type TaskAccess } from './cases';
import { AGE_BUCKETS, ageBucket, daysUntil } from '@/lib/format';
import { CASE_STATUSES } from '@/types';

export interface DashboardMetrics {
  totalMatters: number;
  activeMatters: number;
  concludedMatters: number;
  confidentialMatters: number;
  hearingsToday: CourtDate[];
  hearingsThisWeek: CourtDate[];
  hearingsNext30: CourtDate[];
  openTasks: number;
  overdueTasks: number;
  tasksDueToday: number;
  documentCount: number;
  totalExposure: number;
  byStatus: Array<{ status: CaseStatus; count: number }>;
  byPriority: Array<{ priority: string; count: number }>;
  byAgeBucket: Array<{ bucket: string; count: number }>;
  byCourtTier: Array<{ tier: string; count: number }>;
  workload: Array<{ user: User; open: number; hearings: number; overdue: number }>;
  filingTrend: Array<{ month: string; filed: number; concluded: number }>;
}

const ACTIVE_STATUSES: CaseStatus[] = ['Filed', 'Pending', 'Adjourned', 'Heard'];
const CLOSED_STATUSES: CaseStatus[] = ['Judgment Delivered', 'Concluded', 'Closed', 'Archived'];

/**
 * One pass over the visible rows produces every figure on the dashboard, so the
 * cards, the charts and the tables can never disagree with one another.
 */
export function buildDashboardMetrics(
  data: Dataset,
  rows: CaseRow[],
  now: Date = new Date(),
  taskAccess: TaskAccess = { userId: null, canSeeUnitTasks: true },
): DashboardMetrics {
  const visibleIds = new Set(rows.map((row) => row.record.id));
  const hearings = data.courtDates.filter(
    (sitting) => visibleIds.has(sitting.caseId) && !sitting.outcome,
  );
  const tasks = visibleTasks(data.tasks, rows, taskAccess);
  const openTasks = tasks.filter(
    (task) => task.status !== 'Completed' && task.status !== 'Cancelled',
  );

  const statusCounts = new Map<CaseStatus, number>();
  const priorityCounts = new Map<string, number>();
  const ageCounts = new Map<string, number>();
  const tierCounts = new Map<string, number>();

  rows.forEach((row) => {
    statusCounts.set(row.record.status, (statusCounts.get(row.record.status) ?? 0) + 1);
    priorityCounts.set(row.record.priority, (priorityCounts.get(row.record.priority) ?? 0) + 1);
    const bucket = ageBucket(row.record.filingDate ?? row.record.createdAt);
    ageCounts.set(bucket, (ageCounts.get(bucket) ?? 0) + 1);
    tierCounts.set(String(row.courtTier), (tierCounts.get(String(row.courtTier)) ?? 0) + 1);
  });

  // Filed vs concluded over the last 12 months.
  const trend = new Map<string, { filed: number; concluded: number }>();
  for (let i = 11; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    trend.set(monthKey(date), { filed: 0, concluded: 0 });
  }
  rows.forEach((row) => {
    if (row.record.filingDate) {
      const key = monthKey(new Date(row.record.filingDate));
      const entry = trend.get(key);
      if (entry) entry.filed += 1;
    }
    if (CLOSED_STATUSES.includes(row.record.status)) {
      const key = monthKey(new Date(row.record.updatedAt));
      const entry = trend.get(key);
      if (entry) entry.concluded += 1;
    }
  });

  return {
    totalMatters: rows.length,
    activeMatters: rows.filter((row) => ACTIVE_STATUSES.includes(row.record.status)).length,
    concludedMatters: rows.filter((row) => CLOSED_STATUSES.includes(row.record.status)).length,
    confidentialMatters: rows.filter((row) => row.record.confidential).length,
    hearingsToday: hearings.filter((sitting) => daysUntil(sitting.startsAt) === 0),
    hearingsThisWeek: hearings.filter((sitting) => {
      const days = daysUntil(sitting.startsAt);
      return days >= 0 && days <= 7;
    }),
    hearingsNext30: hearings.filter((sitting) => {
      const days = daysUntil(sitting.startsAt);
      return days >= 0 && days <= 30;
    }),
    openTasks: openTasks.length,
    overdueTasks: openTasks.filter((task) => daysUntil(task.dueDate) < 0).length,
    tasksDueToday: openTasks.filter((task) => daysUntil(task.dueDate) === 0).length,
    documentCount: data.documents.filter((document) => visibleIds.has(document.caseId)).length,
    totalExposure: rows.reduce((sum, row) => sum + (row.record.claimValue ?? 0), 0),
    byStatus: CASE_STATUSES.map((status) => ({ status, count: statusCounts.get(status) ?? 0 })),
    byPriority: ['Critical', 'High', 'Medium', 'Low'].map((priority) => ({
      priority,
      count: priorityCounts.get(priority) ?? 0,
    })),
    byAgeBucket: AGE_BUCKETS.map((bucket) => ({ bucket, count: ageCounts.get(bucket) ?? 0 })),
    byCourtTier: [...tierCounts.entries()]
      .map(([tier, count]) => ({ tier, count }))
      .sort((a, b) => b.count - a.count),
    workload: buildWorkload(data, rows),
    filingTrend: [...trend.entries()].map(([month, value]) => ({ month, ...value })),
  };
}

function monthKey(date: Date) {
  return date.toLocaleDateString('en-NG', { month: 'short', year: '2-digit' });
}

/** Workload by lawyer — the TOR §18 report, reused as a dashboard table. */
export function buildWorkload(data: Dataset, rows: CaseRow[]) {
  const fileHolders = data.users.filter((user) =>
    ['SUPER_ADMIN', 'ADMIN', 'LEGAL_STAFF'].includes(user.role),
  );

  return fileHolders
    .map((user) => {
      const owned = rows.filter(
        (row) => row.record.matterOwnerId === user.id || row.record.assigneeIds.includes(user.id),
      );
      const ownedIds = new Set(owned.map((row) => row.record.id));
      const userTasks = data.tasks.filter(
        (task) => task.ownerId === user.id && task.status !== 'Completed',
      );

      return {
        user,
        open: owned.filter((row) => ACTIVE_STATUSES.includes(row.record.status)).length,
        hearings: data.courtDates.filter(
          (sitting) =>
            ownedIds.has(sitting.caseId) &&
            !sitting.outcome &&
            daysUntil(sitting.startsAt) >= 0 &&
            daysUntil(sitting.startsAt) <= 30,
        ).length,
        overdue: userTasks.filter((task) => daysUntil(task.dueDate) < 0).length,
      };
    })
    .sort((a, b) => b.open - a.open);
}

/** "My work" panel — the personal slice of the dashboard. */
export interface MyWork {
  myMatters: CaseRow[];
  myHearings: CourtDate[];
  myTasks: Task[];
  myOverdue: Task[];
  unread: AppNotification[];
}

export function buildMyWork(data: Dataset, rows: CaseRow[], userId: string | null): MyWork {
  if (!userId) {
    return { myMatters: [], myHearings: [], myTasks: [], myOverdue: [], unread: [] };
  }

  // Stakeholders count here too: for a read-only account these are the only
  // matters they hold, and leaving them out emptied the whole dashboard.
  const myMatters = rows.filter(
    (row) =>
      row.record.matterOwnerId === userId ||
      row.record.assigneeIds.includes(userId) ||
      row.record.externalCounselIds.includes(userId) ||
      row.record.stakeholderIds.includes(userId),
  );
  const myIds = new Set(myMatters.map((row) => row.record.id));
  const myTasks = data.tasks
    .filter((task) => task.ownerId === userId && task.status !== 'Completed')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return {
    myMatters,
    myHearings: data.courtDates
      .filter(
        (sitting) =>
          !sitting.outcome &&
          daysUntil(sitting.startsAt) >= 0 &&
          (sitting.attendeeIds.includes(userId) || myIds.has(sitting.caseId)),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    myTasks,
    myOverdue: myTasks.filter((task) => daysUntil(task.dueDate) < 0),
    unread: data.notifications.filter((item) => item.userId === userId && !item.read),
  };
}
