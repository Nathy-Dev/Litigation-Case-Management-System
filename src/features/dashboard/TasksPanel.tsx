import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Circle, AlertCircle } from 'lucide-react';
import type { Task } from '@/types';
import { formatDueLabel, daysUntil } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCan, useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge, PRIORITY_TONE } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';

/** Task list used by the dashboards; ticking a row completes it in place. */
export function TasksPanel({
  tasks,
  title = 'My tasks',
  description = 'Due soonest first. Tick to complete.',
  limit = 6,
  showOwner = false,
}: {
  tasks: Task[];
  title?: string;
  description?: string;
  limit?: number;
  showOwner?: boolean;
}) {
  const cases = useDataStore((state) => state.cases);
  const users = useDataStore((state) => state.users);
  const updateTask = useDataStore((state) => state.updateTask);
  const canComplete = useCan('task.complete');
  const currentUser = useCurrentUser();

  const complete = (task: Task) => {
    updateTask(
      task.id,
      { status: 'Completed', completedAt: new Date().toISOString() },
      currentUser?.id ?? 'system',
    );
    notify({ variant: 'success', title: 'Task completed', description: task.title });
  };

  return (
    <Card flush>
      <CardHeader
        title={title}
        description={description}
        icon={<ClipboardList className="size-4" aria-hidden />}
        actions={
          <ButtonLink to="/tasks" variant="ghost" size="sm">
            All tasks
          </ButtonLink>
        }
        divided
      />
      {tasks.length === 0 ? (
        <EmptyState
          compact
          icon={<CheckCircle2 className="size-5" aria-hidden />}
          title="Nothing outstanding"
          description="No open tasks are assigned to you."
        />
      ) : (
        <ul className="divide-y divide-ink-100">
          {tasks.slice(0, limit).map((task) => {
            const matter = task.caseId ? cases.find((item) => item.id === task.caseId) : undefined;
            const owner = users.find((item) => item.id === task.ownerId);
            const overdue = daysUntil(task.dueDate) < 0;

            return (
              <li key={task.id} className="flex items-start gap-3 px-4 py-3">
                <button
                  type="button"
                  disabled={!canComplete}
                  onClick={() => complete(task)}
                  aria-label={`Mark “${task.title}” complete`}
                  className="mt-0.5 shrink-0 rounded-full text-ink-300 transition-colors hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Circle className="size-4.5" aria-hidden />
                </button>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink-900">{task.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-500">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 font-medium',
                        overdue ? 'text-danger-600' : 'text-ink-600',
                      )}
                    >
                      {overdue && <AlertCircle className="size-3" aria-hidden />}
                      {formatDueLabel(task.dueDate)}
                    </span>
                    {matter && (
                      <Link
                        to={`/cases/${matter.id}`}
                        className="truncate font-mono text-[11px] text-brand-700 hover:underline"
                      >
                        {matter.caseId}
                      </Link>
                    )}
                    {showOwner && owner && (
                      <span className="inline-flex items-center gap-1">
                        <Avatar user={owner} size="xs" />
                        {owner.fullName}
                      </span>
                    )}
                  </div>
                </div>

                <Badge tone={PRIORITY_TONE[task.priority]} size="sm">
                  {task.priority}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
