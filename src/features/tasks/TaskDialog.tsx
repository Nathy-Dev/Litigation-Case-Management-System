import { useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import type { CasePriority, Task, TaskStatus } from '@/types';
import { useDataStore } from '@/store/dataStore';
import { useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';

const PRIORITIES: CasePriority[] = ['Critical', 'High', 'Medium', 'Low'];
const STATUSES: TaskStatus[] = ['Not Started', 'In Progress', 'Blocked', 'Completed', 'Cancelled'];

/** Create or edit a task (TOR §20). Pass `caseId` to bind it to a matter. */
export function TaskDialog({
  open,
  onClose,
  task,
  caseId,
}: {
  open: boolean;
  onClose: () => void;
  /** Supplied when editing. */
  task?: Task | null;
  /** Pre-binds a new task to this matter; null keeps it a standalone task. */
  caseId?: string | null;
}) {
  const users = useDataStore((state) => state.users);
  const teams = useDataStore((state) => state.teams);
  const cases = useDataStore((state) => state.cases);
  const createTask = useDataStore((state) => state.createTask);
  const updateTask = useDataStore((state) => state.updateTask);
  const user = useCurrentUser();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [linkedCaseId, setLinkedCaseId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<CasePriority>('Medium');
  const [status, setStatus] = useState<TaskStatus>('Not Started');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setOwnerId(task?.ownerId ?? user?.id ?? '');
    setTeamId(task?.assignedTeamId ?? '');
    setLinkedCaseId(task?.caseId ?? caseId ?? '');
    setDueDate(format(task ? new Date(task.dueDate) : addDays(new Date(), 7), 'yyyy-MM-dd'));
    setPriority(task?.priority ?? 'Medium');
    setStatus(task?.status ?? 'Not Started');
    setError(undefined);
  }, [open, task, caseId, user?.id]);

  const assignable = users.filter(
    (item) => item.status === 'active' && item.role !== 'READ_ONLY',
  );

  const submit = () => {
    if (title.trim().length < 4) {
      setError('Give the task a clear title.');
      return;
    }
    const actorId = user?.id ?? 'system';
    const dueIso = new Date(`${dueDate}T17:00:00`).toISOString();

    if (task) {
      updateTask(
        task.id,
        {
          title: title.trim(),
          description: description.trim(),
          ownerId,
          assignedTeamId: teamId || null,
          caseId: linkedCaseId || null,
          dueDate: dueIso,
          priority,
          status,
        },
        actorId,
      );
      notify({ variant: 'success', title: 'Task updated' });
    } else {
      createTask(
        {
          caseId: linkedCaseId || null,
          title: title.trim(),
          description: description.trim(),
          ownerId,
          assignedTeamId: teamId || null,
          dueDate: dueIso,
          priority,
        },
        actorId,
      );
      notify({
        variant: 'success',
        title: 'Task created',
        description: `Assigned to ${users.find((item) => item.id === ownerId)?.fullName ?? 'the team'} · due ${format(new Date(dueIso), 'dd/MM/yyyy')}.`,
      });
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? 'Edit task' : 'New task'}
      description={
        caseId
          ? cases.find((item) => item.id === caseId)?.caseId
          : 'Tasks can stand alone or be tied to a matter.'
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {task ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Task" required error={error}>
          {(props) => (
            <Input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setError(undefined);
              }}
              placeholder="e.g. File counter-affidavit and written address"
              {...props}
            />
          )}
        </Field>

        <Field label="Detail" hint="What exactly needs doing, and any constraint to be aware of.">
          {(props) => (
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              {...props}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner" required>
            {(props) => (
              <Select
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
                {...props}
              >
                {assignable.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName} — {item.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Supporting team" hint="Optional — for shared visibility.">
            {(props) => (
              <Select value={teamId} onChange={(event) => setTeamId(event.target.value)} {...props}>
                <option value="">No team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Due date" required>
            {(props) => (
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                {...props}
              />
            )}
          </Field>
          <Field label="Priority">
            {(props) => (
              <Select
                value={priority}
                onChange={(event) => setPriority(event.target.value as CasePriority)}
                {...props}
              >
                {PRIORITIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {task && (
            <Field label="Status">
              {(props) => (
                <Select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as TaskStatus)}
                  {...props}
                >
                  {STATUSES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        {!caseId && (
          <Field label="Related matter" hint="Leave blank for administrative work.">
            {(props) => (
              <Select
                value={linkedCaseId}
                onChange={(event) => setLinkedCaseId(event.target.value)}
                {...props}
              >
                <option value="">Not tied to a matter</option>
                {cases
                  .filter((item) => !item.archivedAt)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.caseId} — {item.title}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
      </div>
    </Modal>
  );
}
