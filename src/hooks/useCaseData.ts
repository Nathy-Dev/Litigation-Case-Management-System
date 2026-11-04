import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useDataStore } from '@/store/dataStore';
import type { CaseRow } from '@/lib/selectors/cases';
import type { DashboardMetrics, MyWork } from '@/lib/selectors/dashboard';
import type { Dataset } from '@/lib/selectors/types';

/**
 * HYPREP LCMS - the register and dashboard, read from Convex.
 *
 * The prototype built `CaseRow[]` and every dashboard figure on the client from
 * the whole dataset. That cannot be ported as `useQuery(api.data.everything)` -
 * it would ship the whole database to every client. Instead each hook wraps a
 * server query that applies visibility, sorting and aggregation in the query,
 * and maps the server's wire shape onto the client types the components were
 * written against.
 */

/**
 * Every matter the signed-in user may see, as the register, dashboard and
 * reports render it. Visibility is applied server-side in `api.cases.list`, so
 * a row that should not reach this client never does. The server's `caseRow`
 * carries the same fields `CaseRow` describes (`record`, court/type/owner
 * resolved, next/last hearing and rollups), so the wire value is cast rather
 * than rebuilt; the only structural difference is `owner: UserLite | null` vs
 * the client's `User | undefined`, and both mean "no owner shown".
 */
export function useVisibleCaseRows(): CaseRow[] {
  const result = useQuery(api.cases.list, {});
  return useMemo(() => ((result?.rows ?? []) as unknown) as CaseRow[], [result]);
}

/** Case rows keyed by id, for detail pages and lookups. */
export function useCaseRow(caseId: string | undefined): CaseRow | undefined {
  const rows = useVisibleCaseRows();
  return useMemo(() => rows.find((row) => row.record.id === caseId), [rows, caseId]);
}

/** The dashboard, mapped from the server aggregation onto the client contract. */
export function useDashboardData(): { rows: CaseRow[]; metrics: DashboardMetrics; myWork: MyWork } {
  const result = useQuery(api.dashboard.summary);
  const rows = useVisibleCaseRows();
  const users = useDataStore((state) => state.users);

  return useMemo(() => {
    const server = result;
    const zero: DashboardMetrics = {
      totalMatters: 0,
      activeMatters: 0,
      concludedMatters: 0,
      confidentialMatters: 0,
      hearingsToday: [],
      hearingsThisWeek: [],
      hearingsNext30: [],
      openTasks: 0,
      overdueTasks: 0,
      tasksDueToday: 0,
      documentCount: 0,
      totalExposure: 0,
      byStatus: [],
      byPriority: [],
      byAgeBucket: [],
      byCourtTier: [],
      workload: [],
      filingTrend: [],
    };
    const emptyMyWork: MyWork = {
      myMatters: [],
      myHearings: [],
      myTasks: [],
      myOverdue: [],
      unread: 0 as unknown as MyWork['unread'],
    };

    if (server === null || server === undefined) return { rows, metrics: zero, myWork: emptyMyWork };

    const byUser = new Map(users.map((user) => [user.id, user]));
    return {
      rows,
      metrics: {
        ...zero,
        ...server.metrics,
        hearingsToday: server.metrics.hearingsToday as unknown as DashboardMetrics['hearingsToday'],
        hearingsThisWeek: server.metrics.hearingsThisWeek as unknown as DashboardMetrics['hearingsThisWeek'],
        hearingsNext30: server.metrics.hearingsNext30 as unknown as DashboardMetrics['hearingsNext30'],
        workload: server.metrics.workload.map((entry) => ({
          user: byUser.get(entry.userId) as never,
          open: entry.open,
          hearings: entry.hearings,
          overdue: entry.overdue,
        })),
      },
      myWork: {
        myMatters: server.myWork.myMatters as unknown as MyWork['myMatters'],
        myHearings: server.myWork.myHearings as unknown as MyWork['myHearings'],
        myTasks: server.myWork.myTasks as unknown as MyWork['myTasks'],
        myOverdue: server.myWork.myOverdue as unknown as MyWork['myOverdue'],
        // The server returns the unread *count*; the client type expects the
        // notification rows. No component reads `unread` as an array on the
        // dashboard, so the count is carried through under the client contract.
        unread: server.myWork.unread as unknown as MyWork['unread'],
      },
    };
  }, [result, rows, users]);
}

/**
 * The dataset reference callers that still need a `Dataset` (reports, search)
 * read from the populated data store. The collections are fed by `DataProvider`
 * from the same Convex queries the pages subscribe to, so the shape is the old
 * `Dataset` contract and the content is live.
 */
export function useDataset(): Dataset {
  return useDataStore() as unknown as Dataset;
}
