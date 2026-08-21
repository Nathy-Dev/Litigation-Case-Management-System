import type { AuditLogEntry, CaseDocument, CaseRecord, CourtDate, Task, User } from '@/types';
import { pick } from '@/lib/utils';
import {
  IP_POOL,
  USER_AGENT_POOL,
  chance,
  hoursBefore,
  intBetween,
  minutesBefore,
  rngFor,
} from './helpers';

interface Sources {
  now: Date;
  users: User[];
  cases: CaseRecord[];
  documents: CaseDocument[];
  courtDates: CourtDate[];
  tasks: Task[];
}

type EntryInput = Omit<AuditLogEntry, 'ipAddress' | 'userAgent' | 'outcome' | 'metadata'> &
  Partial<Pick<AuditLogEntry, 'ipAddress' | 'userAgent' | 'outcome' | 'metadata'>>;

/**
 * Every entry carries the timestamp, actor and IP address required by TOR §15.
 * Entries are generated *from* the seeded records, so each row in the trail
 * refers to something the reviewer can actually open.
 */
function entry(parts: EntryInput, rng: () => number): AuditLogEntry {
  return {
    outcome: 'success',
    metadata: {},
    ipAddress: pick(rng, IP_POOL),
    userAgent: pick(rng, USER_AGENT_POOL),
    ...parts,
  };
}

export function buildAuditLog({
  now,
  users,
  cases,
  documents,
  courtDates,
  tasks,
}: Sources): AuditLogEntry[] {
  const entries: AuditLogEntry[] = [];
  const activeUsers = users.filter((user) => user.status === 'active');

  // A monotonic cursor so generated "read" events spread out over recent hours.
  let cursor = 0;
  const nextRecent = (step = 3) => hoursBefore(now, (cursor += step) / 4);

  // ---- Sessions: sign-in / sign-out over the past fortnight ----------------
  activeUsers.forEach((user, userIndex) => {
    const rng = rngFor('audit-session', userIndex);
    const ip = pick(rng, IP_POOL);
    const agent = pick(rng, USER_AGENT_POOL);
    const logins = intBetween(rng, 2, 6);

    for (let i = 0; i < logins; i += 1) {
      // Whole-hour offsets put several people's sign-in on the same instant, so
      // each account gets its own minute within the hour.
      const offset = i * 24 + intBetween(rng, 1, 9) + intBetween(rng, 0, 59) / 60;
      entries.push(
        entry(
          {
            id: `aud_login_${user.id}_${i + 1}`,
            at: hoursBefore(now, offset),
            actorId: user.id,
            action: 'Signed in',
            entity: 'Session',
            entityId: `ses_${user.id}_${i + 1}`,
            entityLabel: `${user.fullName} — ${agent.includes('Mobile') ? 'mobile' : 'desktop'}`,
            ipAddress: ip,
            userAgent: agent,
            metadata: {
              mfa: user.mfaEnabled,
              method: user.mfaEnabled ? 'password + authenticator' : 'password',
            },
          },
          rng,
        ),
      );

      if (i > 0) {
        entries.push(
          entry(
            {
              id: `aud_logout_${user.id}_${i + 1}`,
              at: hoursBefore(now, offset - 1),
              actorId: user.id,
              action: chance(rng, 0.3) ? 'Session expired after inactivity' : 'Signed out',
              entity: 'Session',
              entityId: `ses_${user.id}_${i + 1}`,
              entityLabel: `${user.fullName} — session ended`,
              ipAddress: ip,
              userAgent: agent,
              metadata: { durationMinutes: intBetween(rng, 12, 260) },
            },
            rng,
          ),
        );
      }
    }
  });

  // ---- Failed sign-ins culminating in a lockout (TOR §26) ------------------
  const lockedUser = users.find((user) => user.status === 'locked');
  if (lockedUser) {
    const rng = rngFor('audit-lockout');
    const ip = pick(rng, IP_POOL);
    for (let i = 0; i < 5; i += 1) {
      entries.push(
        entry(
          {
            id: `aud_failed_${i + 1}`,
            at: minutesBefore(now, 250 - i * 3),
            actorId: lockedUser.id,
            action: 'Failed sign-in attempt',
            entity: 'Session',
            entityId: `ses_failed_${i + 1}`,
            entityLabel: `${lockedUser.fullName} — invalid password`,
            ipAddress: ip,
            outcome: 'failure',
            metadata: { attempt: i + 1, threshold: 5 },
          },
          rng,
        ),
      );
    }
    entries.push(
      entry(
        {
          id: 'aud_lockout',
          at: minutesBefore(now, 234),
          actorId: lockedUser.id,
          action: 'Account locked after 5 failed attempts',
          entity: 'User',
          entityId: lockedUser.id,
          entityLabel: lockedUser.fullName,
          ipAddress: ip,
          outcome: 'failure',
          metadata: { lockoutMinutes: 30, requiresAdminUnlock: true },
        },
        rng,
      ),
    );
  }

  // ---- Case lifecycle -----------------------------------------------------
  cases.forEach((record, index) => {
    const rng = rngFor('audit-case', index);
    const label = `${record.caseId} — ${record.title}`;

    entries.push(
      entry(
        {
          id: `aud_case_create_${record.id}`,
          at: record.createdAt,
          actorId: record.createdById,
          action: 'Created case',
          entity: 'Case',
          entityId: record.id,
          entityLabel: label,
          metadata: {
            status: record.status,
            priority: record.priority,
            confidential: record.confidential,
          },
        },
        rng,
      ),
      entry(
        {
          id: `aud_case_update_${record.id}`,
          at: record.updatedAt,
          actorId: record.matterOwnerId,
          action: 'Updated case details',
          entity: 'Case',
          entityId: record.id,
          entityLabel: label,
          metadata: {
            fields: pick(rng, [
              'summary, reliefSought',
              'presidingJudge',
              'assigneeIds',
              'tags',
              'claimValue',
            ]),
          },
        },
        rng,
      ),
    );

    // Confidential matters record every read, per the access-control brief.
    if (record.confidential) {
      const permitted = record.restrictedToUserIds.length
        ? record.restrictedToUserIds
        : [record.matterOwnerId];
      entries.push(
        entry(
          {
            id: `aud_case_view_${record.id}`,
            at: nextRecent(),
            actorId: pick(rng, permitted),
            action: 'Viewed confidential case',
            entity: 'Case',
            entityId: record.id,
            entityLabel: label,
            metadata: { accessBasis: 'named on the restriction list' },
          },
          rng,
        ),
      );
    }

    if (record.archivedAt) {
      entries.push(
        entry(
          {
            id: `aud_case_archive_${record.id}`,
            at: record.archivedAt,
            actorId: 'usr_okonkwo',
            action: 'Archived case',
            entity: 'Case',
            entityId: record.id,
            entityLabel: label,
            metadata: { retentionYears: 7 },
          },
          rng,
        ),
      );
    }
  });

  // ---- Documents: uploads, downloads, check-out ----------------------------
  documents.slice(0, 130).forEach((document, index) => {
    const rng = rngFor('audit-doc', index);
    const latest = document.versions[document.versions.length - 1]!;

    entries.push(
      entry(
        {
          id: `aud_doc_upload_${document.id}`,
          at: latest.uploadedAt,
          actorId: latest.uploadedById,
          action: latest.version === 1 ? 'Uploaded document' : `Uploaded version ${latest.version}`,
          entity: 'Document',
          entityId: document.id,
          entityLabel: document.name,
          metadata: {
            caseId: document.caseId,
            sizeBytes: latest.sizeBytes,
            format: document.format,
            confidential: document.confidential,
          },
        },
        rng,
      ),
    );

    if (chance(rng, 0.55)) {
      entries.push(
        entry(
          {
            id: `aud_doc_download_${document.id}`,
            at: nextRecent(2),
            actorId: document.authorId,
            action: document.confidential
              ? 'Downloaded confidential document'
              : 'Downloaded document',
            entity: 'Document',
            entityId: document.id,
            entityLabel: document.name,
            metadata: { watermarked: document.confidential, caseId: document.caseId },
          },
          rng,
        ),
      );
    }

    if (document.checkedOutById && document.checkedOutAt) {
      entries.push(
        entry(
          {
            id: `aud_doc_checkout_${document.id}`,
            at: document.checkedOutAt,
            actorId: document.checkedOutById,
            action: 'Checked out document for editing',
            entity: 'Document',
            entityId: document.id,
            entityLabel: document.name,
            metadata: { lockedToOthers: true },
          },
          rng,
        ),
      );
    }
  });

  // ---- Court dates and tasks ----------------------------------------------
  courtDates
    .filter((sitting) => sitting.outcome)
    .slice(0, 70)
    .forEach((sitting, index) => {
      const rng = rngFor('audit-courtdate', index);
      entries.push(
        entry(
          {
            id: `aud_cd_outcome_${sitting.id}`,
            at: sitting.outcomeRecordedAt ?? sitting.startsAt,
            actorId: sitting.outcomeRecordedById ?? sitting.createdById,
            action: 'Recorded hearing outcome',
            entity: 'CourtDate',
            entityId: sitting.id,
            entityLabel: `${sitting.purpose} — ${sitting.courtRoom}`,
            metadata: {
              outcome: sitting.outcome ?? '',
              caseId: sitting.caseId,
              adjourned: Boolean(sitting.adjournedToDateId),
            },
          },
          rng,
        ),
      );
    });

  tasks
    .filter((task) => task.completedAt)
    .slice(0, 45)
    .forEach((task, index) => {
      const rng = rngFor('audit-task', index);
      entries.push(
        entry(
          {
            id: `aud_task_done_${task.id}`,
            at: task.completedAt!,
            actorId: task.ownerId,
            action: 'Completed task',
            entity: 'Task',
            entityId: task.id,
            entityLabel: task.title,
            metadata: { caseId: task.caseId ?? 'unlinked', priority: task.priority },
          },
          rng,
        ),
      );
    });

  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
