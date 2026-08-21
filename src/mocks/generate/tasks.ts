import type { CaseRecord, Task, TaskPriority, TaskStatus } from '@/types';
import { pick } from '@/lib/utils';
import { at, chance, intBetween, rngFor, sample } from './helpers';

/** Task templates keyed to where the matter has reached. */
const BY_STATUS: Record<string, string[]> = {
  Draft: [
    'Settle the draft originating process',
    'Obtain the Director’s approval to commence action',
    'Confirm the correct defendant and its registered address at CAC',
  ],
  Filed: [
    'Effect service on the defendant and file proof of service',
    'Pay filing fees and collect the receipted copies',
    'Diarise the return date and notify the matter owner',
    'Open the physical case file and index the bundle',
  ],
  Pending: [
    'Prepare the reply to the statement of defence',
    'Compile the list and schedule of documents',
    'Interview and prepare PW1 for cross-examination',
    'File the motion on notice for extension of time',
    'Obtain certified true copies of the exhibits',
    'Brief external counsel ahead of the next hearing',
  ],
  Adjourned: [
    'Confirm the adjourned date with the registry',
    'Serve the hearing notice on the 2nd defendant',
    'Follow up on the outstanding registry records',
    'Update the community liaison officer on the adjournment',
  ],
  Heard: [
    'File the final written address within the time ordered',
    'Prepare a judgment risk memorandum for the Director',
    'Diarise the judgment date and arrange attendance',
  ],
  'Judgment Delivered': [
    'Obtain the certified true copy of the judgment',
    'Advise on the merits of an appeal within the 90-day window',
    'Prepare the enrolled order for the registry',
  ],
  Concluded: [
    'File the closing memorandum on the case file',
    'Confirm the cost order has been satisfied',
  ],
  Closed: ['Archive the physical file per the retention policy'],
  Archived: [],
};

/** Unit-level work, with the note each one actually needs. `[title, priority, note]`. */
const STANDALONE_TASKS = [
  [
    'Compile the quarterly litigation report for the Project Coordinator',
    'High',
    'Figures to be drawn from the case register as at the last day of the quarter.',
  ],
  [
    'Review the standard remediation contract dispute-resolution clause',
    'Medium',
    'Arbitration seat and governing law to be settled with Procurement.',
  ],
  ['Renew the Unit’s subscription to the law reports', 'Low', ''],
  [
    'Update the external counsel fee schedule for the new financial year',
    'Medium',
    'Needs the Director’s approval before it is issued to the firms on the panel.',
  ],
  [
    'Prepare the Legal Unit input to the NDPR compliance audit',
    'High',
    'Covers how matter files are retained and who may download a confidential document.',
  ],
  ['Reconcile the case register against the registry cause lists', 'Medium', ''],
] as const;

const DESCRIPTIONS = [
  'Raised at the weekly Unit meeting. Deliverable to be saved to the matter file on completion.',
  'Time-bound by the rules of court — escalate to the Head of Unit if it cannot be met.',
  'Coordinate with the Community Liaison desk before responding.',
  'Confirm the position with external counsel before filing anything at the registry.',
  'Attach the supporting documents to this task when done.',
];

export function buildTasks(now: Date, cases: CaseRecord[]): Task[] {
  const tasks: Task[] = [];

  cases.forEach((record, caseIndex) => {
    const rng = rngFor('task', caseIndex);
    const pool = BY_STATUS[record.status] ?? [];
    if (!pool.length) return;

    const count = Math.min(pool.length, record.priority === 'Critical' ? 4 : intBetween(rng, 1, 3));
    const titles = sample(rng, pool, count);
    const candidates = record.assigneeIds.length ? record.assigneeIds : [record.matterOwnerId];

    titles.forEach((title, index) => {
      // A deliberate mix: overdue, due today, due soon, and already completed.
      const bucket = (caseIndex + index) % 6;
      const dueOffset =
        bucket === 0
          ? -intBetween(rng, 2, 21) // overdue
          : bucket === 1
            ? 0 // due today
            : bucket === 2
              ? intBetween(rng, 1, 3)
              : bucket === 3
                ? intBetween(rng, 4, 14)
                : intBetween(rng, 15, 45);

      const completed = bucket === 4 || (bucket === 5 && chance(rng, 0.5));
      const status: TaskStatus = completed
        ? 'Completed'
        : dueOffset < 0
          ? pick(rng, ['In Progress', 'Blocked', 'Not Started'])
          : pick(rng, ['Not Started', 'In Progress', 'In Progress']);

      // Lateness is already stated, in red, by the due date. Only a task that
      // has slipped badly is escalated, so the priority badge keeps saying
      // something the date does not.
      const priority: TaskPriority =
        dueOffset < -14 && !completed
          ? record.priority === 'Low'
            ? 'Medium'
            : 'Critical'
          : record.priority;

      tasks.push({
        id: `tsk_${record.id.slice(5)}_${index + 1}`,
        caseId: record.id,
        title,
        description: chance(rng, 0.3) ? pick(rng, DESCRIPTIONS) : '',
        ownerId: pick(rng, candidates),
        assignedTeamId: chance(rng, 0.25) ? record.teamId : null,
        dueDate: at(now, dueOffset, 17, 0),
        priority,
        status,
        checklist: chance(rng, 0.45)
          ? [
              { id: `chk_${record.id.slice(5)}_${index + 1}_1`, label: 'Draft prepared', done: true },
              {
                id: `chk_${record.id.slice(5)}_${index + 1}_2`,
                label: 'Reviewed by the matter owner',
                done: completed,
              },
              {
                id: `chk_${record.id.slice(5)}_${index + 1}_3`,
                label: 'Filed / served and proof on file',
                done: completed,
              },
            ]
          : [],
        attachmentDocumentIds: [],
        createdById: record.matterOwnerId,
        createdAt: at(now, dueOffset - intBetween(rng, 5, 20), 10, 0),
        completedAt: completed ? at(now, -intBetween(rng, 1, 10), 15, 30) : null,
        workflowTemplateId: index === 0 && record.status === 'Filed' ? 'wf_filing' : null,
      });
    });
  });

  // Unit-level tasks that are not tied to a single matter.
  STANDALONE_TASKS.forEach(([title, priority, note], index) => {
    const rng = rngFor('standalone-task', index);
    tasks.push({
      id: `tsk_unit_${index + 1}`,
      caseId: null,
      title,
      description: note,
      ownerId: pick(rng, ['usr_okonkwo', 'usr_adeyemi', 'usr_bassey', 'usr_ngozi', 'usr_musa']),
      assignedTeamId: null,
      dueDate: at(now, index === 0 ? -4 : intBetween(rng, 2, 40), 17, 0),
      priority: priority as TaskPriority,
      status: index === 0 ? 'In Progress' : pick(rng, ['Not Started', 'In Progress', 'Completed']),
      checklist: [],
      attachmentDocumentIds: [],
      createdById: 'usr_okonkwo',
      createdAt: at(now, -intBetween(rng, 10, 40), 9, 0),
      completedAt: null,
      workflowTemplateId: null,
    });
  });

  return tasks;
}
