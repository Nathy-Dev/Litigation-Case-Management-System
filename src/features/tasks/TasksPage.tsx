import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, LayoutList, ListTodo, Plus, Search, SquareKanban, UserCheck } from 'lucide-react';
import type { Task } from '@/types';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCan, useCurrentUser } from '@/store/authStore';
import { useVisibleCaseRows } from '@/hooks/useCaseData';
import { DAY_MS, useNow } from '@/hooks/useNow';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FilterMenu } from '@/components/ui/FilterMenu';
import { TaskList } from './TaskList';
import { TaskBoard } from './TaskBoard';
import { TaskDialog } from './TaskDialog';

const TASK_STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Completed', 'Cancelled'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

/** Tasks and deadlines (TOR §17) across every matter the viewer can see. */
export function TasksPage() {
  const tasks = useDataStore((state) => state.tasks);
  const users = useDataStore((state) => state.users);
  const rows = useVisibleCaseRows();
  const user = useCurrentUser();
  const canCreate = useCan('task.create');
  const canAssign = useCan('task.assign');
  const now = useNow();

  const [mode, setMode] = useState<'list' | 'board'>('list');
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [mineOnly, setMineOnly] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);

  /** Tasks follow the register: no matter access, no task. Standalone tasks
   * (not bound to a matter) are always visible to their unit. */
  const visible = useMemo(() => {
    const allowed = new Set(rows.map((row) => row.record.id));
    return tasks.filter((task) => task.caseId === null || allowed.has(task.caseId));
  }, [tasks, rows]);

  const mine = visible.filter((task) => task.ownerId === user?.id);
  const openTasks = visible.filter(
    (task) => task.status !== 'Completed' && task.status !== 'Cancelled',
  );
  const overdue = openTasks.filter((task) => new Date(task.dueDate).getTime() < now);
  const dueThisWeek = openTasks.filter((task) => {
    const days = (new Date(task.dueDate).getTime() - now) / DAY_MS;
    return days >= 0 && days <= 7;
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = mineOnly ? mine : visible;
    return pool
      .filter((task) => {
        if (statuses.length && !statuses.includes(task.status)) return false;
        if (priorities.length && !priorities.includes(task.priority)) return false;
        if (ownerIds.length && !ownerIds.includes(task.ownerId)) return false;
        if (!needle) return true;
        return (
          task.title.toLowerCase().includes(needle) ||
          task.description.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [visible, mine, mineOnly, query, statuses, priorities, ownerIds]);

  const owners = useMemo(() => {
    const ids = new Set(visible.map((task) => task.ownerId));
    return users.filter((item) => ids.has(item.id));
  }, [visible, users]);

  return (
    <div>
      <PageHeader
        title="Tasks & deadlines"
        hint="Work raised on matters, with owners, due dates and checklists. Overdue items are flagged in red."
        actions={
          canCreate && (
            <Button
              variant="primary"
              onClick={() => setCreating(true)}
              icon={<Plus className="size-4" aria-hidden />}
            >
              New task
            </Button>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open tasks"
          value={formatNumber(openTasks.length)}
          hint={`${visible.length} raised in total`}
          icon={<ListTodo className="size-4" aria-hidden />}
        />
        <StatCard
          label="Overdue"
          value={formatNumber(overdue.length)}
          hint="Past their due date and not completed"
          tone={overdue.length > 0 ? 'danger' : 'default'}
          icon={<Clock className="size-4" aria-hidden />}
        />
        <StatCard
          label="Due within 7 days"
          value={formatNumber(dueThisWeek.length)}
          hint="Includes today"
          tone={dueThisWeek.length > 0 ? 'gold' : 'default'}
          icon={<CheckCircle2 className="size-4" aria-hidden />}
        />
        <StatCard
          label="Assigned to me"
          value={formatNumber(mine.filter((task) => task.status !== 'Completed').length)}
          hint={`${mine.length} in total`}
          tone="brand"
          icon={<UserCheck className="size-4" aria-hidden />}
        />
      </div>

      <Card className="mt-4" flush>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 p-3">
          <div className="min-w-52 flex-1">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks…"
              leading={<Search className="size-4" aria-hidden />}
              aria-label="Search tasks"
            />
          </div>
          <FilterMenu
            label="Status"
            width="w-56"
            options={TASK_STATUSES.map((value) => ({
              value,
              label: value,
              count: visible.filter((task) => task.status === value).length,
            }))}
            selected={statuses}
            onChange={setStatuses}
          />
          <FilterMenu
            label="Priority"
            width="w-48"
            options={PRIORITIES.map((value) => ({
              value,
              label: value,
              count: visible.filter((task) => task.priority === value).length,
            }))}
            selected={priorities}
            onChange={setPriorities}
          />
          <FilterMenu
            label="Owner"
            searchable
            width="w-72"
            options={owners.map((item) => ({
              value: item.id,
              label: item.fullName,
              count: visible.filter((task) => task.ownerId === item.id).length,
            }))}
            selected={ownerIds}
            onChange={setOwnerIds}
          />
          <Button
            size="sm"
            variant={mineOnly ? 'subtle' : 'secondary'}
            onClick={() => setMineOnly((value) => !value)}
          >
            {mineOnly ? 'Showing mine' : 'Only mine'}
          </Button>

          <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-ink-100 p-0.5">
            {([
              { value: 'list' as const, label: 'List', icon: <LayoutList className="size-3.5" aria-hidden /> },
              { value: 'board' as const, label: 'Board', icon: <SquareKanban className="size-3.5" aria-hidden /> },
            ]).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                aria-pressed={mode === option.value}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                  mode === option.value
                    ? 'bg-white text-ink-900 shadow-xs'
                    : 'text-ink-600 hover:text-ink-900',
                )}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <CardBody className={mode === 'list' ? 'p-0' : undefined}>
          {mode === 'list' ? (
            <TaskList
              tasks={filtered}
              onEdit={canAssign ? setEditing : undefined}
              showCase
              emptyTitle="Nothing matches those filters"
              emptyDescription="Clear a filter to see more of the workload."
            />
          ) : (
            <TaskBoard
              tasks={filtered}
              onEdit={canAssign ? setEditing : undefined}
              canAssign={canAssign}
            />
          )}
        </CardBody>
      </Card>

      <TaskDialog open={creating} onClose={() => setCreating(false)} />
      <TaskDialog open={Boolean(editing)} onClose={() => setEditing(null)} task={editing} />
    </div>
  );
}
