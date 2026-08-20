import { useState } from 'react';
import { CheckCircle2, ChevronDown, Circle, ListChecks, MoreHorizontal, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Task, TaskStatus } from '@/types';
import { formatDueLabel, daysUntil } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCurrentUser } from '@/store/authStore';
import { PriorityBadge, TaskStatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Dropdown, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/Dropdown';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';

const NEXT_STATUS: TaskStatus[] = ['Not Started', 'In Progress', 'Blocked', 'Completed', 'Cancelled'];

/** Shared task rows — used by the case Tasks tab and the Tasks page list view. */
export function TaskList({
  tasks,
  onEdit,
  showCase = false,
  emptyTitle = 'No tasks',
  emptyDescription = 'Work assigned on this matter will appear here.',
}: {
  tasks: Task[];
  onEdit?: (task: Task) => void;
  showCase?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<ListChecks className="size-6" aria-hidden />}
        title={emptyTitle}
        description={emptyDescription}
        compact
      />
    );
  }

  return (
    <ul className="divide-y divide-ink-100">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} onEdit={onEdit} showCase={showCase} />
      ))}
    </ul>
  );
}

function TaskRow({
  task,
  onEdit,
  showCase,
}: {
  task: Task;
  onEdit?: (task: Task) => void;
  showCase?: boolean;
}) {
  const users = useDataStore((state) => state.users);
  const cases = useDataStore((state) => state.cases);
  const teams = useDataStore((state) => state.teams);
  const updateTask = useDataStore((state) => state.updateTask);
  const toggleChecklistItem = useDataStore((state) => state.toggleChecklistItem);
  const currentUser = useCurrentUser();

  const [expanded, setExpanded] = useState(false);

  const owner = users.find((item) => item.id === task.ownerId);
  const team = teams.find((item) => item.id === task.assignedTeamId);
  const matter = showCase && task.caseId ? cases.find((item) => item.id === task.caseId) : undefined;
  const done = task.status === 'Completed';
  const cancelled = task.status === 'Cancelled';
  const overdue = !done && !cancelled && daysUntil(task.dueDate) < 0;
  const checked = task.checklist.filter((item) => item.done).length;

  const setStatus = (status: TaskStatus) =>
    updateTask(task.id, { status }, currentUser?.id ?? 'system');

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setStatus(done ? 'In Progress' : 'Completed')}
          className="mt-0.5 shrink-0 rounded-full text-ink-300 transition-colors hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
          aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} complete`}
        >
          {done ? (
            <CheckCircle2 className="size-5 text-brand-600" aria-hidden />
          ) : (
            <Circle className="size-5" aria-hidden />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p
              className={cn(
                'text-[13px] font-medium',
                done || cancelled ? 'text-ink-400 line-through' : 'text-ink-900',
              )}
            >
              {task.title}
            </p>
            <TaskStatusBadge status={task.status} size="sm" />
            {!done && !cancelled && <PriorityBadge priority={task.priority} size="sm" />}
          </div>

          {task.description && (
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-500">
              {task.description}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-500">
            <span className={cn(overdue && 'font-semibold text-danger-600')}>
              {formatDueLabel(task.dueDate)}
            </span>
            {matter && (
              <>
                <span aria-hidden>·</span>
                <Link
                  to={`/cases/${matter.id}?tab=tasks`}
                  className="font-mono text-brand-700 hover:underline"
                >
                  {matter.caseId}
                </Link>
              </>
            )}
            {team && (
              <>
                <span aria-hidden>·</span>
                <span>{team.name}</span>
              </>
            )}
            {task.workflowTemplateId && (
              <>
                <span aria-hidden>·</span>
                <span className="text-ink-400">from workflow</span>
              </>
            )}
            {task.checklist.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  className="inline-flex items-center gap-1 font-medium text-ink-600 hover:text-brand-700"
                  aria-expanded={expanded}
                >
                  <ListChecks className="size-3" aria-hidden />
                  {checked}/{task.checklist.length} steps
                  <ChevronDown
                    className={cn('size-3 transition-transform', expanded && 'rotate-180')}
                    aria-hidden
                  />
                </button>
              </>
            )}
          </div>

          {expanded && task.checklist.length > 0 && (
            <ul className="mt-2 space-y-1 rounded-lg bg-ink-50 p-2.5">
              {task.checklist.map((item) => (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-start gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggleChecklistItem(task.id, item.id)}
                      className="mt-0.5 size-3.5 rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
                    />
                    <span className={cn(item.done ? 'text-ink-400 line-through' : 'text-ink-700')}>
                      {item.label}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        {owner && (
          <span className="mt-0.5 hidden shrink-0 sm:block" title={owner.fullName}>
            <Avatar user={owner} size="xs" />
          </span>
        )}

        <Dropdown
          trigger={({ toggle }) => (
            <Button
              size="sm"
              variant="ghost"
              onClick={toggle}
              aria-label={`Actions for ${task.title}`}
              icon={<MoreHorizontal className="size-4" aria-hidden />}
            />
          )}
        >
          {(close) => (
            <>
              <MenuLabel>Set status</MenuLabel>
              {NEXT_STATUS.filter((status) => status !== task.status).map((status) => (
                <MenuItem
                  key={status}
                  onClick={() => {
                    setStatus(status);
                    close();
                  }}
                >
                  {status}
                </MenuItem>
              ))}
              {onEdit && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon={<Pencil className="size-4" aria-hidden />}
                    onClick={() => {
                      onEdit(task);
                      close();
                    }}
                  >
                    Edit task
                  </MenuItem>
                </>
              )}
            </>
          )}
        </Dropdown>
      </div>
    </li>
  );
}
