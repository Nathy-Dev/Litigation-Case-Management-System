import { useMemo } from 'react';
import { useDataStore } from '@/store/dataStore';
import { useCurrentUser, usePermission } from '@/store/authStore';
import { buildCaseRows, visibleToUser, type CaseRow } from '@/lib/selectors/cases';
import { buildDashboardMetrics, buildMyWork } from '@/lib/selectors/dashboard';
import type { Dataset } from '@/mocks/generate';

/** The whole dataset. Kept in one place so pages don't subscribe piecemeal. */
export function useDataset(): Dataset {
  return useDataStore();
}

/**
 * Every matter the signed-in user may see, already joined to court, owner,
 * next hearing and task counts. This is the row model behind the register, the
 * dashboard, the reports and the exports, so all four always agree.
 */
export function useVisibleCaseRows(): CaseRow[] {
  const data = useDataStore();
  const user = useCurrentUser();
  const can = usePermission();
  const canViewAll = can('case.view.all');

  return useMemo(
    () => visibleToUser(buildCaseRows(data), user, canViewAll),
    [data, user, canViewAll],
  );
}

/** Case rows keyed by id, for detail pages and lookups. */
export function useCaseRow(caseId: string | undefined): CaseRow | undefined {
  const rows = useVisibleCaseRows();
  return useMemo(() => rows.find((row) => row.record.id === caseId), [rows, caseId]);
}

export function useDashboardData() {
  const data = useDataStore();
  const rows = useVisibleCaseRows();
  const user = useCurrentUser();
  const can = usePermission();
  // Standing in the Legal Unit, not the right to view a task: an oversight
  // stakeholder holds `task.view` but none of the Unit's own admin work.
  const canSeeUnitTasks = can('task.create');

  return useMemo(() => {
    const now = new Date();
    const taskAccess = { userId: user?.id ?? null, canSeeUnitTasks };
    return {
      rows,
      metrics: buildDashboardMetrics(data, rows, now, taskAccess),
      myWork: buildMyWork(data, rows, user?.id ?? null),
    };
  }, [data, rows, user?.id, canSeeUnitTasks]);
}
