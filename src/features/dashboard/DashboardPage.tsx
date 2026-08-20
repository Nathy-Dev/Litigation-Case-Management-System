import { useMemo } from 'react';
import {
  BarChart3,
  CalendarDays,
  FileText,
  FolderOpen,
  Gavel,
  Landmark,
  ListTodo,
  Plus,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { formatDateLong, formatNairaCompact, formatNumber } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/permissions';
import { selectRecentActivity } from '@/lib/selectors/search';
import { useCurrentUser, useCan } from '@/store/authStore';
import { useDataStore } from '@/store/dataStore';
import { useDashboardData } from '@/hooks/useCaseData';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { CategoryBarChart, DonutChart, TrendChart } from '@/components/charts/Charts';
import { HearingsPanel } from './HearingsPanel';
import { TasksPanel } from './TasksPanel';
import { MattersPanel } from './MattersPanel';
import { ActivityFeed } from './ActivityFeed';
import { WorkloadPanel } from './WorkloadPanel';
import { SystemHealthPanel } from './SystemHealthPanel';

export function DashboardPage() {
  const user = useCurrentUser();
  const data = useDataStore();
  const { rows, metrics, myWork } = useDashboardData();

  const canSeeAll = useCan('case.view.all');
  const canCreate = useCan('case.create');
  const canReport = useCan('report.view');
  const canSeeSystem = useCan('system.manage');

  const activity = useMemo(
    () => selectRecentActivity(data, new Set(rows.map((row) => row.record.id)), 12),
    [data, rows],
  );

  const attention = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            row.overdueTasks > 0 ||
            (!row.nextHearing && ['Filed', 'Pending', 'Adjourned'].includes(row.record.status)) ||
            row.record.priority === 'Critical',
        )
        .sort((a, b) => b.overdueTasks - a.overdueTasks || b.ageDays - a.ageDays),
    [rows],
  );

  const statusData = metrics.byStatus
    .filter((entry) => entry.count > 0)
    .map((entry) => ({ label: entry.status, value: entry.count }));
  const tierData = metrics.byCourtTier
    .filter((entry) => entry.count > 0)
    .map((entry) => ({ label: entry.tier, value: entry.count }));

  const isStakeholder = user?.role === 'READ_ONLY';
  const isCounsel = user?.role === 'EXTERNAL_COUNSEL';

  return (
    <>
      <PageHeader
        title={`Good day, ${user?.fullName.replace(/^(Barr\.|Dr\.|Engr\.)\s*/, '').split(' ')[0] ?? 'there'}`}
        description={
          <>
            {ROLE_LABELS[user?.role ?? 'READ_ONLY']} · {formatDateLong(new Date().toISOString())} ·{' '}
            {canSeeAll
              ? 'You are seeing every matter on the register.'
              : 'You are seeing the matters assigned to you.'}
          </>
        }
        actions={
          <>
            {canReport && (
              <ButtonLink to="/reports" variant="secondary" icon={<BarChart3 className="size-4" aria-hidden />}>
                Reports
              </ButtonLink>
            )}
            {canCreate && (
              <ButtonLink to="/cases/new" variant="primary" icon={<Plus className="size-4" aria-hidden />}>
                New matter
              </ButtonLink>
            )}
          </>
        }
      />

      {/* Headline figures ------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label={canSeeAll ? 'Matters on register' : 'My matters'}
          value={formatNumber(metrics.totalMatters)}
          hint={`${formatNumber(metrics.activeMatters)} active`}
          icon={<FolderOpen className="size-4" aria-hidden />}
          tone="brand"
          to="/cases"
        />
        <StatCard
          label="Hearings this week"
          value={formatNumber(metrics.hearingsThisWeek.length)}
          hint={
            metrics.hearingsToday.length > 0
              ? `${metrics.hearingsToday.length} sitting today`
              : `${metrics.hearingsNext30.length} in 30 days`
          }
          icon={<CalendarDays className="size-4" aria-hidden />}
          tone={metrics.hearingsToday.length > 0 ? 'gold' : 'default'}
          to="/calendar"
        />
        <StatCard
          label="Open tasks"
          value={formatNumber(metrics.openTasks)}
          hint={metrics.overdueTasks > 0 ? `${metrics.overdueTasks} overdue` : 'None overdue'}
          icon={<ListTodo className="size-4" aria-hidden />}
          tone={metrics.overdueTasks > 0 ? 'danger' : 'default'}
          to="/tasks"
        />
        <StatCard
          label="Exposure at claim"
          value={formatNairaCompact(metrics.totalExposure)}
          hint={`${formatNumber(metrics.documentCount)} documents filed`}
          icon={<Landmark className="size-4" aria-hidden />}
        />
      </div>

      {/* Role-specific arrangement --------------------------------------- */}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {isStakeholder ? (
            <>
              <Card flush>
                <CardHeader
                  title="Caseload by status"
                  hint="Every matter on the register, grouped by where it stands."
                  icon={<BarChart3 className="size-4" aria-hidden />}
                  divided
                />
                <div className="px-2 py-4 sm:px-4">
                  <CategoryBarChart data={statusData} height={300} />
                </div>
              </Card>
              <Card flush>
                <CardHeader
                  title="Filed against concluded"
                  description="Last twelve months."
                  divided
                />
                <div className="px-2 py-4 sm:px-4">
                  <TrendChart data={metrics.filingTrend} />
                </div>
              </Card>
            </>
          ) : (
            <>
              <HearingsPanel
                hearings={isCounsel || !canSeeAll ? myWork.myHearings : metrics.hearingsNext30}
                title={canSeeAll ? 'Court diary — next 30 days' : 'My court diary'}
                description="Reminders go out one week, three days and 24 hours ahead."
                limit={6}
              />

              {attention.length > 0 && (
                <MattersPanel
                  rows={attention}
                  title="Needs attention"
                  description="Overdue tasks, critical priority, or no hearing date fixed."
                  limit={5}
                  to="/cases?filter=attention"
                  linkLabel="Review all"
                  emptyMessage="Nothing is flagged."
                />
              )}

              {canSeeAll && (
                <Card flush>
                  <CardHeader
                    title="Caseload by status"
                    description="Click a bar to filter the register."
                    icon={<BarChart3 className="size-4" aria-hidden />}
                    divided
                  />
                  <div className="px-2 py-4 sm:px-4">
                    <CategoryBarChart data={statusData} height={280} />
                  </div>
                </Card>
              )}
            </>
          )}

          {canSeeAll && !isStakeholder && <WorkloadPanel workload={metrics.workload} />}
        </div>

        <div className="space-y-4">
          {!isStakeholder && (
            <TasksPanel
              tasks={[...myWork.myOverdue, ...myWork.myTasks.filter((task) => !myWork.myOverdue.includes(task))]}
              title="My tasks"
              description={
                myWork.myOverdue.length > 0
                  ? `${myWork.myOverdue.length} overdue — shown first.`
                  : 'Due soonest first. Tick to complete.'
              }
            />
          )}

          {isStakeholder && (
            <Card flush>
              <CardHeader title="Matters by court tier" divided />
              <div className="px-2 py-4">
                <DonutChart data={tierData} centreLabel={formatNumber(metrics.totalMatters)} />
              </div>
            </Card>
          )}

          {(isCounsel || !canSeeAll) && (
            <MattersPanel
              rows={myWork.myMatters}
              title="Assigned to me"
              description="Matters where you are owner, assignee or counsel."
              limit={5}
              emptyMessage="No matters are assigned to you yet."
            />
          )}

          {metrics.confidentialMatters > 0 && (
            <Card>
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gold-50 text-gold-700">
                  <ShieldAlert className="size-4.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink-900">
                    {formatNumber(metrics.confidentialMatters)} confidential{' '}
                    {metrics.confidentialMatters === 1 ? 'matter' : 'matters'}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-ink-500">
                    Restricted to named users. Downloads are watermarked and every view is written to
                    the audit trail.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {canSeeSystem && <SystemHealthPanel />}

          <ActivityFeed events={activity} limit={8} />
        </div>
      </div>

      {/* Second row of charts for the wide desktop layout ---------------- */}
      {canSeeAll && !isStakeholder && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card flush>
            <CardHeader
              title="Filed against concluded"
              hint="Twelve-month trend — a widening gap means the backlog is growing."
              icon={<Gavel className="size-4" aria-hidden />}
              divided
            />
            <div className="px-2 py-4 sm:px-4">
              <TrendChart data={metrics.filingTrend} />
            </div>
          </Card>
          <Card flush>
            <CardHeader
              title="Age of matters"
              hint="Days since filing, bucketed as in the standard report."
              icon={<TriangleAlert className="size-4" aria-hidden />}
              divided
            />
            <div className="px-2 py-4 sm:px-4">
              <CategoryBarChart
                data={metrics.byAgeBucket.map((entry) => ({ label: entry.bucket, value: entry.count }))}
                height={250}
                colour="#b8860b"
              />
            </div>
          </Card>
        </div>
      )}

      {isStakeholder && (
        <div className="mt-4">
          <MattersPanel
            rows={rows.slice(0, 8)}
            title="Register extract"
            description="Read-only view. Export the full register from Reports."
            limit={8}
            to="/reports"
            linkLabel="Reports"
          />
        </div>
      )}

      {!canSeeAll && myWork.myMatters.length === 0 && (
        <Card className="mt-4">
          <div className="flex items-start gap-3">
            <FileText className="mt-0.5 size-5 shrink-0 text-ink-400" aria-hidden />
            <p className="text-[13px] leading-relaxed text-ink-600">
              Nothing has been assigned to you yet. Once a matter names you as owner, assignee or
              counsel it will appear here, together with its hearing diary and documents.
            </p>
          </div>
        </Card>
      )}
    </>
  );
}
