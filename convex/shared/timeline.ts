import type { TimelineEventType } from './enums';

/**
 * HYPREP LCMS - case timeline assembly (TOR section 11).
 *
 * The timeline is *derived*, never stored: it is composed on read from the
 * records it describes, so the feed cannot drift out of step with the register.
 *
 * **This module returns structured events, not prose.** The version this
 * replaces composed its `summary` and `detail` strings inline, calling
 * `src/lib/format.ts` for dates and hearing slots. That is the wrong side of the
 * wire for two reasons: it bakes one locale's presentation into stored-shaped
 * data, and it would drag a client formatting module into the Convex runtime.
 * Each event therefore carries the *operands* of its sentence - a document name,
 * a task title, a party count - and the component writes the sentence.
 *
 * Every event is discriminated by `type`, so a component renders it with an
 * exhaustive switch and the compiler flags any event kind it has not handled.
 *
 * Two variants - `document.checked_in` and `courtdate.updated` - are declared but
 * not yet emitted: the enum has always listed them and the icon map has always
 * had rows for them, but no source record carries the fields needed to derive
 * them. The check-in and reschedule mutations will emit them when they land.
 * They are declared now so the union covers the enum exactly, which is what the
 * assertion below enforces.
 */

/** Fields common to every event, whatever its kind. */
interface TimelineEventBase {
  id: string;
  /** The human-readable matter number (e.g. `HYP/LCMS/2026/0042`). */
  caseId: string;
  /** Who performed the act. Null where the system did it unattended. */
  actorId: string | null;
  /** ISO 8601 UTC. Sorts lexicographically. */
  at: string;
  /** The record the event points at, for deep-linking. */
  refId: string | null;
}

/**
 * The event union.
 *
 * `data` holds exactly what the sentence needs and nothing more - deliberately
 * narrow, so a component cannot quietly start depending on a field the query
 * does not promise to keep populating.
 */
export type TimelineEvent =
  | (TimelineEventBase & {
      type: 'case.created';
      data: { caseNumber: string; caseReference: string | null; partyCount: number };
    })
  | (TimelineEventBase & {
      type: 'counsel.assigned';
      data: { counselId: string };
    })
  | (TimelineEventBase & {
      type: 'case.archived';
      data: Record<string, never>;
    })
  | (TimelineEventBase & {
      type: 'case.status.changed';
      data: { from: string; to: string; reason: string };
    })
  | (TimelineEventBase & {
      type: 'case.updated';
      data: { to: string; reason: string };
    })
  | (TimelineEventBase & {
      type: 'document.uploaded';
      data: { documentName: string; changeNote: string };
    })
  | (TimelineEventBase & {
      type: 'document.version.added';
      data: { documentName: string; version: number; changeNote: string };
    })
  | (TimelineEventBase & {
      type: 'document.checked_out';
      data: { documentName: string };
    })
  | (TimelineEventBase & {
      type: 'document.checked_in';
      data: { documentName: string; version: number };
    })
  | (TimelineEventBase & {
      type: 'courtdate.created';
      data: { startsAt: string; purpose: string; judge: string; courtRoom: string };
    })
  | (TimelineEventBase & {
      type: 'courtdate.updated';
      data: { startsAt: string; previousStartsAt: string; purpose: string };
    })
  | (TimelineEventBase & {
      type: 'courtdate.outcome.recorded';
      data: { outcome: string; outcomeNotes: string; adjourned: boolean };
    })
  | (TimelineEventBase & {
      type: 'task.created';
      data: { title: string; dueDate: string; priority: string };
    })
  | (TimelineEventBase & {
      type: 'task.completed';
      data: { title: string };
    })
  | (TimelineEventBase & {
      type: 'note.added';
      data: { body: string; internalOnly: boolean };
    });

/**
 * Compile-time assertion that the union covers exactly the `TIMELINE_EVENT_TYPES`
 * enum the schema validates against - no more, no less. Adding a value to the
 * enum without adding its variant here is a type error, and vice versa.
 */
type _EventTypesMatchEnum = TimelineEvent['type'] extends TimelineEventType
  ? TimelineEventType extends TimelineEvent['type']
    ? true
    : never
  : never;
const _eventTypesMatchEnum: _EventTypesMatchEnum = true;
void _eventTypesMatchEnum;

// ---------------------------------------------------------------------------
// Source record shapes
// ---------------------------------------------------------------------------

/**
 * The fields this module reads, and only those.
 *
 * Structural, not `Doc<'cases'>`: it keeps the builder callable from a query
 * that projected a subset, and from a test with hand-built fixtures, without
 * either having to satisfy the full document type.
 */
interface CaseSource {
  id: string;
  caseId: string;
  caseReference: string | null;
  parties: readonly unknown[];
  externalCounselIds: readonly string[];
  matterOwnerId: string;
  createdById: string;
  createdAt: string;
  filingDate: string | null;
  archivedAt: string | null;
  archivedById?: string | null;
}

interface StatusChangeSource {
  id: string;
  caseId: string;
  from: string | null;
  to: string;
  reason: string;
  byUserId: string;
  at: string;
}

interface DocumentVersionSource {
  version: number;
  changeNote: string;
  uploadedById: string;
  uploadedAt: string;
}

interface DocumentSource {
  id: string;
  caseId: string;
  name: string;
  versions: readonly DocumentVersionSource[];
  checkedOutById: string | null;
  checkedOutAt: string | null;
}

interface CourtDateSource {
  id: string;
  caseId: string;
  startsAt: string;
  purpose: string;
  judge: string;
  courtRoom: string;
  createdById: string;
  createdAt: string;
  outcome: string | null;
  outcomeNotes: string;
  outcomeRecordedAt: string | null;
  outcomeRecordedById: string | null;
  adjournedToDateId: string | null;
}

interface TaskSource {
  id: string;
  caseId: string | null;
  title: string;
  dueDate: string;
  priority: string;
  createdById: string;
  createdAt: string;
  ownerId: string;
  completedAt: string | null;
}

interface NoteSource {
  id: string;
  caseId: string;
  body: string;
  internalOnly: boolean;
  authorId: string;
  createdAt: string;
}

export interface TimelineSources {
  cases: readonly CaseSource[];
  statusChanges: readonly StatusChangeSource[];
  documents: readonly DocumentSource[];
  courtDates: readonly CourtDateSource[];
  tasks: readonly TaskSource[];
  notes: readonly NoteSource[];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Derives timeline events from the supplied records, newest first.
 *
 * The caller decides the scope: pass one matter's records for a case timeline,
 * or the visible register's for the dashboard activity feed. Access control is
 * the caller's job - this function trusts what it is handed, so a query must
 * narrow to visible matters *before* calling it.
 */
export function buildTimeline({
  cases,
  statusChanges,
  documents,
  courtDates,
  tasks,
  notes,
}: TimelineSources): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const record of cases) {
    events.push({
      id: `tl_${record.id}_created`,
      caseId: record.id,
      type: 'case.created',
      actorId: record.createdById,
      at: record.createdAt,
      refId: null,
      data: {
        caseNumber: record.caseId,
        caseReference: record.caseReference,
        partyCount: record.parties.length,
      },
    });

    record.externalCounselIds.forEach((counselId, index) => {
      events.push({
        id: `tl_${record.id}_counsel_${index + 1}`,
        caseId: record.id,
        type: 'counsel.assigned',
        actorId: record.matterOwnerId,
        at: record.filingDate ?? record.createdAt,
        refId: counselId,
        data: { counselId },
      });
    });

    if (record.archivedAt) {
      events.push({
        id: `tl_${record.id}_archived`,
        caseId: record.id,
        type: 'case.archived',
        // The mock hardcoded a fixed user here. Archival is usually the
        // retention cron acting unattended, so an absent actor is honest and
        // the component renders it as "the system".
        actorId: record.archivedById ?? null,
        at: record.archivedAt,
        refId: null,
        data: {},
      });
    }
  }

  for (const change of statusChanges) {
    // A null `from` is the opening entry - the status was set, not changed.
    if (change.from === null) {
      events.push({
        id: `tl_${change.id}`,
        caseId: change.caseId,
        type: 'case.updated',
        actorId: change.byUserId,
        at: change.at,
        refId: change.caseId,
        data: { to: change.to, reason: change.reason },
      });
    } else {
      events.push({
        id: `tl_${change.id}`,
        caseId: change.caseId,
        type: 'case.status.changed',
        actorId: change.byUserId,
        at: change.at,
        refId: change.caseId,
        data: { from: change.from, to: change.to, reason: change.reason },
      });
    }
  }

  for (const document of documents) {
    for (const version of document.versions) {
      if (version.version === 1) {
        events.push({
          id: `tl_${document.id}_v1`,
          caseId: document.caseId,
          type: 'document.uploaded',
          actorId: version.uploadedById,
          at: version.uploadedAt,
          refId: document.id,
          data: { documentName: document.name, changeNote: version.changeNote },
        });
      } else {
        events.push({
          id: `tl_${document.id}_v${version.version}`,
          caseId: document.caseId,
          type: 'document.version.added',
          actorId: version.uploadedById,
          at: version.uploadedAt,
          refId: document.id,
          data: {
            documentName: document.name,
            version: version.version,
            changeNote: version.changeNote,
          },
        });
      }
    }

    if (document.checkedOutById && document.checkedOutAt) {
      events.push({
        id: `tl_${document.id}_checkout`,
        caseId: document.caseId,
        type: 'document.checked_out',
        actorId: document.checkedOutById,
        at: document.checkedOutAt,
        refId: document.id,
        data: { documentName: document.name },
      });
    }
  }

  for (const sitting of courtDates) {
    events.push({
      id: `tl_${sitting.id}_created`,
      caseId: sitting.caseId,
      type: 'courtdate.created',
      actorId: sitting.createdById,
      at: sitting.createdAt,
      refId: sitting.id,
      data: {
        startsAt: sitting.startsAt,
        purpose: sitting.purpose,
        judge: sitting.judge,
        courtRoom: sitting.courtRoom,
      },
    });

    if (sitting.outcome && sitting.outcomeRecordedAt && sitting.outcomeRecordedById) {
      events.push({
        id: `tl_${sitting.id}_outcome`,
        caseId: sitting.caseId,
        type: 'courtdate.outcome.recorded',
        actorId: sitting.outcomeRecordedById,
        at: sitting.outcomeRecordedAt,
        refId: sitting.id,
        data: {
          outcome: sitting.outcome,
          outcomeNotes: sitting.outcomeNotes,
          adjourned: sitting.adjournedToDateId !== null,
        },
      });
    }
  }

  for (const task of tasks) {
    // Unit tasks belong to no matter, so they belong on no case timeline.
    if (!task.caseId) continue;
    const caseId = task.caseId;

    events.push({
      id: `tl_${task.id}_created`,
      caseId,
      type: 'task.created',
      actorId: task.createdById,
      at: task.createdAt,
      refId: task.id,
      data: { title: task.title, dueDate: task.dueDate, priority: task.priority },
    });

    if (task.completedAt) {
      events.push({
        id: `tl_${task.id}_done`,
        caseId,
        type: 'task.completed',
        actorId: task.ownerId,
        at: task.completedAt,
        refId: task.id,
        data: { title: task.title },
      });
    }
  }

  for (const note of notes) {
    events.push({
      id: `tl_${note.id}`,
      caseId: note.caseId,
      type: 'note.added',
      actorId: note.authorId,
      at: note.createdAt,
      refId: note.id,
      data: { body: note.body, internalOnly: note.internalOnly },
    });
  }

  // ISO 8601 sorts lexicographically, so this is chronological. Plain `<`
  // rather than `localeCompare`: these are machine timestamps, and collation
  // rules have no business deciding which hearing came first.
  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
