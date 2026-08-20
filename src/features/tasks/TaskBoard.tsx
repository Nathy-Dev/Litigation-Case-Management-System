import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, GripVertical } from 'lucide-react';
import type { Task, TaskStatus } from '@/types';
import { formatDueLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCurrentUser } from '@/store/authStore';
import { Avatar } from '@/components/ui/Avatar';
import { PriorityBadge } from '@/components/ui/Badge';

const COLUMNS: { status: TaskStatus; tint: string }[] = [
  { status: 'Not Started', tint: 'bg-ink-100 text-ink-700' },
  { status: 'In Progress', tint: 'bg-info-100 text-info-800' },
  { status: 'Blocked', tint: 'bg-danger-100 text-danger-800' },
  { status: 'Completed', tint: 'bg-brand-100 text-brand-800' },
];

/** Kanban board (TOR §17). Cards are dragged between columns to change status. */
export function TaskBoard({
  tasks,
  onEdit,
  canAssign,
}: {
  tasks: Task[];
  onEdit?: (task: Task) => void;
  canAssign: boolean;
}) {
  const users = useDataStore((state) => state.users);
  const cases = useDataStore((state) => state.cases);
  const updateTask = useDataStore((state) => state.updateTask);
  const user = useCurrentUser();
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);

  const move = (id: string, status: TaskStatus) => {
    updateTask(id, { status }, user?.id ?? 'system');
  };

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((column) => {
        const cards = tasks.filter((task) => task.status === column.status);
        return (
          <section
            key={column.status}
            onDragOver={(event) => {
              if (!canAssign) return;
              event.preventDefault();
              setDragOver(column.status);
            }}
            onDragLeave={() =>
              setDragOver((current) => (current === column.status ? null : current))
            }
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(null);
              if (!canAssign) return;
              const id = event.dataTransfer.getData('text/plain');
              const task = tasks.find((item) => item.id === id);
              if (task && task.status !== column.status) move(id, column.status);
            }}
            className={cn(
              'flex min-h-40 flex-col rounded-xl border border-ink-200 bg-ink-50/60 p-2',
              dragOver === column.status && 'border-brand-400 bg-brand-50 ring-2 ring-brand-200',
            )}
          >
            <header className="mb-2 flex items-center justify-between px-1">
              <span
                className={cn(
                  'rounded-md px-2 py-0.5 text-[12px] font-semibold',
                  column.tint,
                )}
              >
                {column.status}
              </span>
              <span className="tnum text-[12px] font-medium text-ink-500">{cards.length}</span>
            </header>

            <ul className="space-y-2">
              {cards.map((task) => {
                const owner = users.find((item) => item.id === task.ownerId);
                const matter = cases.find((item) => item.id === task.caseId);
                const overdue =
                  task.status !== 'Completed' &&
                  task.status !== 'Cancelled' &&
                  new Date(task.dueDate) < new Date();

                return (
                  <li key={task.id}>
                    <article
                      draggable={canAssign}
                      onDragStart={(event) => event.dataTransfer.setData('text/plain', task.id)}
                      className={cn(
                        'group rounded-lg border border-ink-200 bg-white p-2.5 shadow-xs',
                        canAssign && 'cursor-grab active:cursor-grabbing',
                      )}
                    >
                      <div className="flex items-start gap-1.5">
                        {canAssign && (
                          <GripVertical
                            className="mt-0.5 size-3.5 shrink-0 text-ink-300"
                            aria-hidden
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => onEdit?.(task)}
                          className="min-w-0 flex-1 text-left text-[13px] font-medium text-ink-900 hover:text-brand-700"
                        >
                          {task.title}
                        </button>
                      </div>

                      {matter && (
                        <Link
                          to={`/cases/${matter.id}`}
                          className="mt-1 block truncate text-[11px] text-brand-700 underline-offset-2 hover:underline"
                        >
                          {matter.caseId} — {matter.title}
                        </Link>
                      )}

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            'flex items-center gap-1 text-[11px] font-medium',
                            overdue ? 'text-danger-600' : 'text-ink-500',
                          )}
                        >
                          {overdue ? (
                            <AlertTriangle className="size-3.5" aria-hidden />
                          ) : (
                            <CalendarClock className="size-3.5" aria-hidden />
                          )}
                          {formatDueLabel(task.dueDate)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <PriorityBadge priority={task.priority} size="sm" />
                          {owner && (
                            <span title={owner.fullName}>
                              <Avatar user={owner} size="xs" />
                            </span>
                          )}
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}

              {cards.length === 0 && (
                <li className="rounded-lg border border-dashed border-ink-200 px-2 py-4 text-center text-[12px] text-ink-400">
                  Nothing here
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
