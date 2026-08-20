import type {
  CaseDocument,
  CaseNote,
  CaseRecord,
  CaseStatusChange,
  CourtDate,
  Task,
  TimelineEvent,
} from '@/types';
import { formatDateMedium, formatHearingSlot } from '@/lib/format';

interface Sources {
  cases: CaseRecord[];
  statusChanges: CaseStatusChange[];
  documents: CaseDocument[];
  courtDates: CourtDate[];
  tasks: Task[];
  notes: CaseNote[];
}

/**
 * Derives the case timeline (TOR §11) from the other entities rather than
 * storing it separately, so the feed can never drift out of step with the
 * records it describes.
 */
export function buildTimeline({
  cases,
  statusChanges,
  documents,
  courtDates,
  tasks,
  notes,
}: Sources): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const push = (event: TimelineEvent) => events.push(event);

  cases.forEach((record) => {
    push({
      id: `tl_${record.id}_created`,
      caseId: record.id,
      type: 'case.created',
      summary: `Matter opened on the register as ${record.caseId}`,
      detail: record.caseReference
        ? `Internal reference ${record.caseReference}. ${record.parties.length} parties recorded.`
        : `${record.parties.length} parties recorded.`,
      actorId: record.createdById,
      at: record.createdAt,
      refId: null,
    });

    record.externalCounselIds.forEach((counselId, index) => {
      push({
        id: `tl_${record.id}_counsel_${index + 1}`,
        caseId: record.id,
        type: 'counsel.assigned',
        summary: 'External counsel briefed on the matter',
        detail: 'Brief to counsel prepared and access granted to the matter file.',
        actorId: record.matterOwnerId,
        at: record.filingDate ?? record.createdAt,
        refId: counselId,
      });
    });

    if (record.archivedAt) {
      push({
        id: `tl_${record.id}_archived`,
        caseId: record.id,
        type: 'case.archived',
        summary: 'Matter archived under the retention policy',
        detail: 'Documents retained in cold storage; record remains searchable.',
        actorId: 'usr_okonkwo',
        at: record.archivedAt,
        refId: null,
      });
    }
  });

  statusChanges.forEach((change) => {
    push({
      id: `tl_${change.id}`,
      caseId: change.caseId,
      type: change.from === null ? 'case.updated' : 'case.status.changed',
      summary:
        change.from === null
          ? `Status set to ${change.to}`
          : `Status changed from ${change.from} to ${change.to}`,
      detail: change.reason,
      actorId: change.byUserId,
      at: change.at,
      refId: change.caseId,
    });
  });

  documents.forEach((document) => {
    document.versions.forEach((version) => {
      push({
        id: `tl_${document.id}_v${version.version}`,
        caseId: document.caseId,
        type: version.version === 1 ? 'document.uploaded' : 'document.version.added',
        summary:
          version.version === 1
            ? `Uploaded “${document.name}”`
            : `Version ${version.version} of “${document.name}” added`,
        detail: version.changeNote,
        actorId: version.uploadedById,
        at: version.uploadedAt,
        refId: document.id,
      });
    });

    if (document.checkedOutById && document.checkedOutAt) {
      push({
        id: `tl_${document.id}_checkout`,
        caseId: document.caseId,
        type: 'document.checked_out',
        summary: `Checked out “${document.name}” for editing`,
        detail: 'The document is locked to other editors until it is checked back in.',
        actorId: document.checkedOutById,
        at: document.checkedOutAt,
        refId: document.id,
      });
    }
  });

  courtDates.forEach((sitting) => {
    push({
      id: `tl_${sitting.id}_created`,
      caseId: sitting.caseId,
      type: 'courtdate.created',
      summary: `Court date fixed for ${formatHearingSlot(sitting.startsAt)}`,
      detail: `${sitting.purpose} before ${sitting.judge} in ${sitting.courtRoom}.`,
      actorId: sitting.createdById,
      at: sitting.createdAt,
      refId: sitting.id,
    });

    if (sitting.outcome && sitting.outcomeRecordedAt && sitting.outcomeRecordedById) {
      push({
        id: `tl_${sitting.id}_outcome`,
        caseId: sitting.caseId,
        type: 'courtdate.outcome.recorded',
        summary: `Hearing outcome recorded: ${sitting.outcome}`,
        detail: sitting.adjournedToDateId
          ? `${sitting.outcomeNotes} Adjourned to a further date.`
          : sitting.outcomeNotes,
        actorId: sitting.outcomeRecordedById,
        at: sitting.outcomeRecordedAt,
        refId: sitting.id,
      });
    }
  });

  tasks.forEach((task) => {
    if (!task.caseId) return;
    push({
      id: `tl_${task.id}_created`,
      caseId: task.caseId,
      type: 'task.created',
      summary: `Task assigned: ${task.title}`,
      detail: `Due ${formatDateMedium(task.dueDate)} · ${task.priority} priority.`,
      actorId: task.createdById,
      at: task.createdAt,
      refId: task.id,
    });

    if (task.completedAt) {
      push({
        id: `tl_${task.id}_done`,
        caseId: task.caseId,
        type: 'task.completed',
        summary: `Task completed: ${task.title}`,
        detail: 'Marked complete by the task owner.',
        actorId: task.ownerId,
        at: task.completedAt,
        refId: task.id,
      });
    }
  });

  notes.forEach((note) => {
    push({
      id: `tl_${note.id}`,
      caseId: note.caseId,
      type: 'note.added',
      summary: note.internalOnly ? 'Internal note added to the file' : 'Note added to the file',
      detail: note.body,
      actorId: note.authorId,
      at: note.createdAt,
      refId: note.id,
    });
  });

  return events.sort((a, b) => b.at.localeCompare(a.at));
}
