import { useMemo, useState } from 'react';
import { addDays } from 'date-fns';
import { ListChecks, Plus, Workflow } from 'lucide-react';
import type { CaseRecord, Task } from '@/types';
import { daysUntil, plural } from '@/lib/format';
import { useDataStore } from '@/store/dataStore';
import { useCan, useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Dropdown, MenuItem, MenuLabel } from '@/components/ui/Dropdown';
import { TaskList } from '@/features/tasks/TaskList';
import { TaskDialog } from '@/features/tasks/TaskDialog';

/** Tasks raised on one matter, plus one-click workflow templates (TOR §20–21). */
export function CaseTasksTab({ caseRecord }: { caseRecord: CaseRecord }) {
  const tasks = useDataStore((state) => state.tasks);
  const users = useDataStore((state) => state.users);
  const templates = useDataStore((state) => state.workflowTemplates);
  const createTask = useDataStore((state) => state.createTask);
  const canManage = useCan('task.create');
  const user = useCurrentUser();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const { open, closed } = useMemo(() => {
    const mine = tasks.filter((task) => task.caseId === caseRecord.id);
    const rank = (task: Task) => (daysUntil(task.dueDate) < 0 ? 0 : 1);
    return {
      open: mine
        .filter((task) => task.status !== 'Completed' && task.status !== 'Cancelled')
        .sort((a, b) => rank(a) - rank(b) || a.dueDate.localeCompare(b.dueDate)),
      closed: mine
        .filter((task) => task.status === 'Completed' || task.status === 'Cancelled')
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    };
  }, [tasks, caseRecord.id]);

  const overdue = open.filter((task) => daysUntil(task.dueDate) < 0).length;

  /** Materialise every step of a template as a dated task on this matter. */
  const applyTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    const actorId = user?.id ?? 'system';

    template.steps.forEach((step) => {
      // Prefer someone already on the matter who holds the step's role.
      const onMatter = [caseRecord.matterOwnerId, ...caseRecord.assigneeIds]
        .map((id) => users.find((item) => item.id === id))
        .find((item) => item?.role === step.defaultOwnerRole);
      const fallback = users.find(
        (item) => item.role === step.defaultOwnerRole && item.status === 'active',
      );

      createTask(
        {
          caseId: caseRecord.id,
          title: step.title,
          description: step.description,
          ownerId: onMatter?.id ?? fallback?.id ?? caseRecord.matterOwnerId,
          dueDate: addDays(new Date(), step.offsetDays).toISOString(),
          priority: step.priority,
        },
        actorId,
      );
    });

    notify({
      variant: 'success',
      title: `${template.name} applied`,
      description: `${plural(template.steps.length, 'task')} raised and assigned.`,
    });
  };

  return (
    <>
      <div className="space-y-4">
        <Card flush>
          <CardHeader
            title="Open tasks"
            description={
              open.length === 0
                ? 'Nothing outstanding on this matter.'
                : `${open.length} outstanding${overdue > 0 ? ` · ${overdue} overdue` : ''}`
            }
            icon={<ListChecks className="size-4" aria-hidden />}
            actions={
              canManage && (
                <div className="flex items-center gap-2">
                  <Dropdown
                    trigger={({ toggle }) => (
                      <Button
                        size="sm"
                        onClick={toggle}
                        icon={<Workflow className="size-4" aria-hidden />}
                      >
                        Apply workflow
                      </Button>
                    )}
                    width="w-72"
                  >
                    {(close) => (
                      <>
                        <MenuLabel>Workflow templates</MenuLabel>
                        {templates.map((template) => (
                          <MenuItem
                            key={template.id}
                            hint={`${template.steps.length} steps`}
                            onClick={() => {
                              applyTemplate(template.id);
                              close();
                            }}
                          >
                            {template.name}
                          </MenuItem>
                        ))}
                      </>
                    )}
                  </Dropdown>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setEditing(null);
                      setDialogOpen(true);
                    }}
                    icon={<Plus className="size-4" aria-hidden />}
                  >
                    New task
                  </Button>
                </div>
              )
            }
            divided
          />
          <TaskList
            tasks={open}
            onEdit={
              canManage
                ? (task) => {
                    setEditing(task);
                    setDialogOpen(true);
                  }
                : undefined
            }
            emptyTitle="No open tasks"
            emptyDescription={
              canManage
                ? 'Raise a task, or apply a workflow template to generate the standard steps.'
                : 'Nothing is outstanding on this matter.'
            }
          />
        </Card>

        {closed.length > 0 && (
          <Card flush>
            <CardHeader
              title="Completed"
              actions={
                <Badge tone="neutral" size="sm">
                  {closed.length}
                </Badge>
              }
              divided
            />
            <TaskList tasks={closed} />
          </Card>
        )}
      </div>

      <TaskDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        task={editing}
        caseId={caseRecord.id}
      />
    </>
  );
}
