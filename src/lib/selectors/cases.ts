import type {
  CasePriority,
  CaseRecord,
  CaseStatus,
  Court,
  CourtDate,
  Paginated,
  Role,
  SortDirection,
  Task,
  User,
} from '@/types';
import type { Dataset } from '@/mocks/generate';
import { ageInDays, daysUntil } from '@/lib/format';
import { matchesQuery } from '@/lib/utils';

/** The row shape the case list, exports and reports all share. */
export interface CaseRow {
  record: CaseRecord;
  courtName: string;
  courtTier: Court['tier'] | '—';
  caseTypeName: string;
  owner: User | undefined;
  partiesLabel: string;
  nextHearing: CourtDate | null;
  lastHearing: CourtDate | null;
  openTasks: number;
  overdueTasks: number;
  documentCount: number;
  ageDays: number;
}

export interface CaseFilters {
  query?: string;
  status?: CaseStatus[];
  priority?: CasePriority[];
  courtIds?: string[];
  caseTypeIds?: string[];
  ownerIds?: string[];
  tags?: string[];
  teamIds?: string[];
  confidentialOnly?: boolean;
  includeArchived?: boolean;
  hearingWithinDays?: number | null;
  filedFrom?: string | null;
  filedTo?: string | null;
  minClaimValue?: number | null;
}

export type CaseSortKey =
  | 'caseId'
  | 'title'
  | 'courtName'
  | 'status'
  | 'priority'
  | 'nextHearing'
  | 'filingDate'
  | 'claimValue'
  | 'ageDays';

/**
 * Builds the enriched rows once, so the list, the calendar sidebar, the reports
 * and the CSV export all read the same numbers.
 */
export function buildCaseRows(data: Dataset): CaseRow[] {
  const courtById = new Map(data.courts.map((court) => [court.id, court]));
  const typeById = new Map(data.caseTypes.map((type) => [type.id, type]));
  const userById = new Map(data.users.map((user) => [user.id, user]));

  const hearingsByCase = new Map<string, CourtDate[]>();
  data.courtDates.forEach((sitting) => {
    const list = hearingsByCase.get(sitting.caseId) ?? [];
    list.push(sitting);
    hearingsByCase.set(sitting.caseId, list);
  });

  const tasksByCase = new Map<string, Task[]>();
  data.tasks.forEach((task) => {
    if (!task.caseId) return;
    const list = tasksByCase.get(task.caseId) ?? [];
    list.push(task);
    tasksByCase.set(task.caseId, list);
  });

  const documentCounts = new Map<string, number>();
  data.documents.forEach((document) =>
    documentCounts.set(document.caseId, (documentCounts.get(document.caseId) ?? 0) + 1),
  );

  return data.cases.map((record) => {
    const sittings = (hearingsByCase.get(record.id) ?? []).sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt),
    );
    const upcoming = sittings.filter((sitting) => !sitting.outcome && daysUntil(sitting.startsAt) >= 0);
    const past = sittings.filter((sitting) => sitting.outcome);
    const tasks = tasksByCase.get(record.id) ?? [];
    const open = tasks.filter((task) => task.status !== 'Completed' && task.status !== 'Cancelled');

    const claimants = record.parties.filter((party) =>
      ['Plaintiff', 'Claimant', 'Appellant', 'Applicant'].includes(party.role),
    );
    const defendants = record.parties.filter((party) =>
      ['Defendant', 'Respondent'].includes(party.role),
    );

    return {
      record,
      courtName: courtById.get(record.courtId)?.name ?? '—',
      courtTier: courtById.get(record.courtId)?.tier ?? '—',
      caseTypeName: typeById.get(record.caseTypeId)?.name ?? '—',
      owner: userById.get(record.matterOwnerId),
      partiesLabel: `${claimants[0]?.name ?? '—'} v. ${defendants[0]?.name ?? '—'}${
        defendants.length > 1 ? ` & ${defendants.length - 1} or.` : ''
      }`,
      nextHearing: upcoming[0] ?? null,
      lastHearing: past[past.length - 1] ?? null,
      openTasks: open.length,
      overdueTasks: open.filter((task) => daysUntil(task.dueDate) < 0).length,
      documentCount: documentCounts.get(record.id) ?? 0,
      ageDays: ageInDays(record.filingDate ?? record.createdAt),
    };
  });
}

/** Row-level access control (TOR §5) applied before any filtering. */
export function visibleToUser(rows: CaseRow[], user: User | null, canViewAll: boolean): CaseRow[] {
  if (!user) return [];
  return rows.filter(({ record }) => {
    if (record.restrictedToUserIds.length && !record.restrictedToUserIds.includes(user.id)) {
      return false;
    }
    if (canViewAll) return true;
    return (
      record.matterOwnerId === user.id ||
      record.assigneeIds.includes(user.id) ||
      record.externalCounselIds.includes(user.id) ||
      record.stakeholderIds.includes(user.id)
    );
  });
}

/**
 * Who may see a task not bound to any matter.
 *
 * `canSeeUnitTasks` is the Legal Unit's own membership test — pass `task.create`
 * for it. Standalone tasks are the Unit's internal work (the quarterly report,
 * the fee schedule, the law-reports subscription), so an oversight stakeholder
 * or a briefed external firm has no business in them even though both hold
 * `task.view`.
 */
export interface TaskAccess {
  userId: string | null;
  canSeeUnitTasks: boolean;
}

/**
 * Tasks follow the register: no access to the matter, no access to its tasks.
 * Applied everywhere a task is counted or listed so the dashboard cards, the
 * task board and the search results cannot disagree.
 */
export function visibleTasks(tasks: Task[], rows: CaseRow[], access: TaskAccess): Task[] {
  const allowed = new Set(rows.map((row) => row.record.id));
  return tasks.filter((task) => {
    if (task.caseId) return allowed.has(task.caseId);
    // Someone assigned a unit task keeps it either way; otherwise it takes
    // membership of the Unit to see it at all.
    return access.canSeeUnitTasks || task.ownerId === access.userId;
  });
}

export function filterCaseRows(rows: CaseRow[], filters: CaseFilters): CaseRow[] {
  return rows.filter((row) => {
    const { record } = row;

    if (!filters.includeArchived && record.status === 'Archived') return false;
    if (filters.status?.length && !filters.status.includes(record.status)) return false;
    if (filters.priority?.length && !filters.priority.includes(record.priority)) return false;
    if (filters.courtIds?.length && !filters.courtIds.includes(record.courtId)) return false;
    if (filters.caseTypeIds?.length && !filters.caseTypeIds.includes(record.caseTypeId)) return false;
    if (filters.ownerIds?.length && !filters.ownerIds.includes(record.matterOwnerId)) return false;
    if (filters.teamIds?.length && (!record.teamId || !filters.teamIds.includes(record.teamId))) {
      return false;
    }
    if (filters.tags?.length && !filters.tags.some((tag) => record.tags.includes(tag))) return false;
    if (filters.confidentialOnly && !record.confidential) return false;

    if (filters.minClaimValue != null && (record.claimValue ?? 0) < filters.minClaimValue) {
      return false;
    }
    if (filters.filedFrom && (record.filingDate ?? '') < filters.filedFrom) return false;
    if (filters.filedTo && (record.filingDate ?? '') > filters.filedTo) return false;

    if (filters.hearingWithinDays != null) {
      const days = row.nextHearing ? daysUntil(row.nextHearing.startsAt) : null;
      if (days == null || days > filters.hearingWithinDays) return false;
    }

    if (filters.query) {
      const haystack = [
        record.caseId,
        record.caseReference ?? '',
        record.title,
        record.suitNumber ?? '',
        record.summary,
        record.presidingJudge ?? '',
        row.courtName,
        row.caseTypeName,
        row.partiesLabel,
        row.owner?.fullName ?? '',
        record.tags.join(' '),
        record.parties.map((party) => party.name).join(' '),
      ].join(' ');
      if (!matchesQuery(haystack, filters.query)) return false;
    }

    return true;
  });
}

const PRIORITY_ORDER: Record<CasePriority, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export function sortCaseRows(rows: CaseRow[], key: CaseSortKey, dir: SortDirection): CaseRow[] {
  const factor = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'priority':
        return (PRIORITY_ORDER[a.record.priority] - PRIORITY_ORDER[b.record.priority]) * factor;
      case 'claimValue':
        return ((a.record.claimValue ?? 0) - (b.record.claimValue ?? 0)) * factor;
      case 'ageDays':
        return (a.ageDays - b.ageDays) * factor;
      case 'nextHearing': {
        // Matters with no fixed date always sort last, whichever direction.
        const left = a.nextHearing?.startsAt ?? '';
        const right = b.nextHearing?.startsAt ?? '';
        if (!left && !right) return 0;
        if (!left) return 1;
        if (!right) return -1;
        return left.localeCompare(right) * factor;
      }
      case 'filingDate':
        return (a.record.filingDate ?? '').localeCompare(b.record.filingDate ?? '') * factor;
      case 'courtName':
        return a.courtName.localeCompare(b.courtName) * factor;
      case 'title':
        return a.record.title.localeCompare(b.record.title) * factor;
      case 'status':
        return a.record.status.localeCompare(b.record.status) * factor;
      case 'caseId':
      default:
        return a.record.caseId.localeCompare(b.record.caseId) * factor;
    }
  });
}

export function paginate<T>(rows: T[], page: number, pageSize: number): Paginated<T> {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  return {
    rows: rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    total: rows.length,
    page: safePage,
    pageSize,
    pageCount,
  };
}

/** Whether a role sees the whole register or only what it is assigned. */
export const ROLES_WITH_FULL_REGISTER: Role[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'LEGAL_STAFF',
  'CASE_OFFICER',
];
