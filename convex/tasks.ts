import { v, type Infer } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalQuery } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { authedMutation, authedQuery } from './lib/functions';
import { canAccessCase, loadAccessibleCase, type AccessActor } from './lib/access';
import { nowIso, recomputeCaseRollups } from './lib/rollups';
import { taskRow, taskListResult } from './shared/query';
import { casePriorityValidator, taskStatusValidator } from './shared/enums';

/**
 * HYPREP LCMS - tasks and the task board.
 *
 * Every task follows the register: no access to the matter, no access to its
 * tasks. Standalone tasks (a `caseId` of `null`) are the Legal Unit's own
 * work, visible only to the Unit and the task's owner.
 *
 * The `openTaskCount`/`overdueTaskCount` rollups on the owning matter are
 * refreshed in the same transaction as any status change.
 */

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

const checklistItemInput = v.object({
  id: v.string(),
  label: v.string(),
  done: v.boolean(),
});

const taskInput = v.object({
  caseId: v.union(v.id('cases'), v.null()),
  title: v.string(),
  description: v.string(),
  ownerId: v.id('users'),
  assignedTeamId: v.union(v.id('teams'), v.null()),
  dueDate: v.string(),
  priority: casePriorityValidator,
  checklist: v.array(checklistItemInput),
  attachmentDocumentIds: v.array(v.id('documents')),
  workflowTemplateId: v.union(v.string(), v.null()),
});

const listArgs = v.object({
  caseId: v.optional(v.id('cases')),
  ownerId: v.optional(v.id('users')),
  status: v.optional(v.array(taskStatusValidator)),
  priority: v.optional(v.array(casePriorityValidator)),
  dueBefore: v.optional(v.string()),
  dueAfter: v.optional(v.string()),
  includeStandalone: v.optional(v.boolean()),
});

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

async function visibleTaskIds(ctx: QueryCtx, actor: AccessActor): Promise<Set<Id<'tasks'>>> {
  const all = await ctx.db.query('tasks').collect();
  const visible = new Set<Id<'tasks'>>();

  // Case-bound tasks: the owning matter's visibility decides.
  const caseIds = new Set<Id<'cases'>>();
  const byCase = new Map<Id<'tasks'>, Id<'cases'>>();
  for (const task of all) {
    if (task.caseId !== null) {
      byCase.set(task._id, task.caseId);
      caseIds.add(task.caseId);
    }
  }

  const visibleCaseIds = new Set<Id<'cases'>>();
  if (actor.permissions.has('case.view.all')) {
    const cases = await ctx.db.query('cases').collect();
    for (const record of cases) {
      if (canAccessCase(record, actor)) visibleCaseIds.add(record._id);
    }
  } else {
    const ids = await ctx.db
      .query('caseMembers')
      .withIndex('by_user', (q) => q.eq('userId', actor.userId))
      .collect();
    for (const row of ids) visibleCaseIds.add(row.caseId);
    // Re-check each candidate matter so a stale projection cannot grant.
    for (const id of [...visibleCaseIds]) {
      const record = await ctx.db.get(id);
      if (record === null || !canAccessCase(record, actor)) visibleCaseIds.delete(id);
    }
  }

  for (const task of all) {
    if (task.caseId !== null) {
      if (visibleCaseIds.has(task.caseId)) visible.add(task._id);
    } else {
      // Standalone: the Unit (task.create) or the task's owner.
      if (actor.permissions.has('task.create') || task.ownerId === actor.userId) visible.add(task._id);
    }
  }

  return visible;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The task board and list, visibility applied in the query. Case-bound tasks
 * inherit the owning matter's visibility; standalone tasks are the Unit's own.
 */
export const list = authedQuery({
  permission: 'task.view',
  args: listArgs,
  returns: taskListResult,
  handler: async (ctx, args) => {
    const actor = ctx.actor;
    const visible = await visibleTaskIds(ctx, actor.access);

    const all = await ctx.db.query('tasks').collect();
    const rows: Infer<typeof taskRow>[] = [];
    for (const task of all) {
      if (!visible.has(task._id)) continue;
      if (args.caseId && task.caseId !== args.caseId) continue;
      if (args.ownerId && task.ownerId !== args.ownerId) continue;
      if (args.status?.length && !args.status.includes(task.status)) continue;
      if (args.priority?.length && !args.priority.includes(task.priority)) continue;
      if (args.dueBefore && task.dueDate > args.dueBefore) continue;
      if (args.dueAfter && task.dueDate < args.dueAfter) continue;
      if (args.includeStandalone === false && task.caseId === null) continue;

      rows.push(toTaskRow(task));
    }

    const ordered = rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return { rows: ordered, total: ordered.length };
  },
});

/** One task, for the detail dialog. */
export const get = authedQuery({
  permission: 'task.view',
  args: { id: v.id('tasks') },
  returns: v.union(taskRow, v.null()),
  handler: async (ctx, { id }) => {
    const task = await ctx.db.get(id);
    if (task === null) return null;
    if (task.caseId !== null) {
      const record = await loadAccessibleCase(ctx, task.caseId, ctx.actor.access);
      if (record === null) return null;
    } else {
      if (
        !ctx.actor.access.permissions.has('task.create') &&
        task.ownerId !== ctx.actor.user._id
      ) {
        return null;
      }
    }
    return toTaskRow(task);
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Creates a task and refreshes the owning matter's task rollups. */
export const createTask = authedMutation({
  permission: 'task.create',
  audit: { entity: 'Task', action: 'Created task' },
  args: { input: taskInput },
  handler: async (ctx, { input }) => {
    const at = nowIso();

    if (input.caseId !== null) {
      await loadAccessibleCase(ctx, input.caseId, ctx.actor.access);
    }

    const id = await ctx.db.insert('tasks', {
      ...input,
      status: 'Not Started',
      completedAt: null,
      createdById: ctx.actor.user._id,
      createdAt: at,
    });

    if (input.caseId !== null) await recomputeCaseRollups(ctx, input.caseId);

    await ctx.audit({
      entityId: id,
      entityLabel: input.title,
      metadata: { ownerId: input.ownerId, dueDate: input.dueDate },
    });

    return { id, caseId: input.caseId };
  },
});

/** Edits a task, keeping `completedAt` honest with the status. */
export const updateTask = authedMutation({
  permission: 'task.assign',
  audit: { entity: 'Task', action: 'Updated task' },
  args: {
    id: v.id('tasks'),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      ownerId: v.optional(v.id('users')),
      assignedTeamId: v.optional(v.union(v.id('teams'), v.null())),
      dueDate: v.optional(v.string()),
      priority: v.optional(casePriorityValidator),
      status: v.optional(taskStatusValidator),
      checklist: v.optional(v.array(checklistItemInput)),
      attachmentDocumentIds: v.optional(v.array(v.id('documents'))),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const task = await ctx.db.get(id);
    if (task === null) throw new Error('Task not found');

    if (task.caseId !== null) {
      await loadAccessibleCase(ctx, task.caseId, ctx.actor.access);
    }

    const status = patch.status ?? task.status;
    const completedAt =
      status === 'Completed'
        ? (task.completedAt ?? nowIso())
        : status !== task.status
          ? null
          : task.completedAt;

    await ctx.db.patch(id, { ...patch, status, completedAt });

    if (task.caseId !== null) await recomputeCaseRollups(ctx, task.caseId);

    await ctx.audit({
      entityId: id,
      entityLabel: task.title,
      metadata: { status },
    });

    return { id, caseId: task.caseId };
  },
});

/** Toggles one checklist item's done flag in place. */
export const toggleChecklistItem = authedMutation({
  permission: 'task.complete',
  audit: { entity: 'Task', action: 'Updated task checklist' },
  args: { taskId: v.id('tasks'), itemId: v.string() },
  handler: async (ctx, { taskId, itemId }) => {
    const task = await ctx.db.get(taskId);
    if (task === null) throw new Error('Task not found');

    if (task.caseId !== null) {
      await loadAccessibleCase(ctx, task.caseId, ctx.actor.access);
    }

    const checklist = task.checklist.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item,
    );
    await ctx.db.patch(taskId, { checklist });

    await ctx.audit({
      entityId: taskId,
      entityLabel: task.title,
      metadata: { itemId },
    });

    return { id: taskId, caseId: task.caseId };
  },
});

// ---------------------------------------------------------------------------
// Internal surface
// ---------------------------------------------------------------------------

/** The task document projected to the wire row (id rather than _id). */
export function toTaskRow(task: Doc<'tasks'>): Infer<typeof taskRow> {
  return {
    id: task._id,
    caseId: task.caseId,
    title: task.title,
    description: task.description,
    ownerId: task.ownerId,
    assignedTeamId: task.assignedTeamId,
    dueDate: task.dueDate,
    priority: task.priority,
    status: task.status,
    checklist: task.checklist,
    attachmentDocumentIds: task.attachmentDocumentIds,
    createdById: task.createdById,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    workflowTemplateId: task.workflowTemplateId,
  };
}

/** The tasks whose due date has passed and are still open — the overdue rollup. */
export const internalOverdue = internalQuery({
  args: { now: v.string() },
  returns: v.array(v.id('tasks')),
  handler: async (ctx, { now }) => {
    const open = await ctx.db
      .query('tasks')
      .withIndex('by_status_dueDate', (q) => q.eq('status', 'Not Started'))
      .collect();
    const inProgress = await ctx.db
      .query('tasks')
      .withIndex('by_status_dueDate', (q) => q.eq('status', 'In Progress'))
      .collect();
    return [...open, ...inProgress]
      .filter((task) => task.dueDate < now && task.caseId !== null)
      .map((task) => task._id);
  },
});
