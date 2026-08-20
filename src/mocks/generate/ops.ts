import type { AuditLogEntry, BackupRecord, SavedView } from '@/types';
import { at, hoursBefore } from './helpers';

/**
 * Nightly backup history (TOR §25). One failure and one in-flight run are
 * included so the recovery screen has something to demonstrate.
 */
export function buildBackups(now: Date): BackupRecord[] {
  const backups: BackupRecord[] = [];

  // A weekly full backup on Sundays, incrementals every other night.
  for (let day = 0; day < 14; day += 1) {
    const startedAt = at(now, -day, 1, 0);
    const isFull = day % 7 === 0;
    const failed = day === 3;

    backups.push({
      id: `bkp_${String(14 - day).padStart(2, '0')}`,
      startedAt,
      completedAt: failed ? null : at(now, -day, isFull ? 2 : 1, isFull ? 12 : 24),
      type: isFull ? 'Full' : 'Incremental',
      scope: isFull ? 'Both' : 'Database',
      sizeGb: failed ? 0 : isFull ? 41.8 - day * 0.4 : 2.1 + (day % 3) * 0.3,
      location: 'Primary data centre (Abuja) → replicated to Lagos',
      status: failed ? 'failed' : 'completed',
    });
  }

  // Tonight's incremental is still running.
  backups.unshift({
    id: 'bkp_15',
    startedAt: hoursBefore(now, 0.4),
    completedAt: null,
    type: 'Incremental',
    scope: 'Document Store',
    sizeGb: 1.2,
    location: 'Primary data centre (Abuja) → replicated to Lagos',
    status: 'running',
  });

  return backups;
}

/** Saved filter sets shown in the Cases / Documents / Tasks list views. */
export function buildSavedViews(): SavedView[] {
  return [
    {
      id: 'sv_active_litigation',
      name: 'Active litigation',
      ownerId: 'usr_okonkwo',
      entity: 'cases',
      filters: { status: ['Filed', 'Pending', 'Adjourned', 'Heard'] },
      shared: true,
    },
    {
      id: 'sv_high_value',
      name: 'High-value exposure (₦500m+)',
      ownerId: 'usr_adeyemi',
      entity: 'cases',
      filters: { minClaimValue: 500_000_000, sort: 'claimValue', dir: 'desc' },
      shared: true,
    },
    {
      id: 'sv_hearings_week',
      name: 'My hearings this week',
      ownerId: 'usr_bassey',
      entity: 'cases',
      filters: { hearingWithinDays: 7, assignee: 'me' },
      shared: false,
    },
    {
      id: 'sv_ogoni_community',
      name: 'Ogoni community matters',
      ownerId: 'usr_dokubo',
      entity: 'cases',
      filters: { tags: ['Ogoniland', 'Community'] },
      shared: true,
    },
    {
      id: 'sv_awaiting_judgment',
      name: 'Awaiting judgment',
      ownerId: 'usr_ibrahim',
      entity: 'cases',
      filters: { status: ['Heard'] },
      shared: false,
    },
    {
      id: 'sv_drafts_checked_out',
      name: 'Drafts checked out',
      ownerId: 'usr_ngozi',
      entity: 'documents',
      filters: { group: 'Draft', checkedOut: true },
      shared: true,
    },
    {
      id: 'sv_overdue_tasks',
      name: 'Overdue across the Unit',
      ownerId: 'usr_okonkwo',
      entity: 'tasks',
      filters: { overdue: true, status: ['Not Started', 'In Progress', 'Blocked'] },
      shared: true,
    },
  ];
}

/**
 * Administrative trail — user management, permission edits, configuration
 * changes, report exports and backup runs. Handwritten because these are the
 * rows a reviewer reads most closely.
 */
export function buildAdminAudit(now: Date): AuditLogEntry[] {
  const rows: Array<
    [number, string, string, AuditLogEntry['entity'], string, string, Record<string, string | number | boolean>]
  > = [
    [
      2,
      'usr_sysadmin',
      'Exported audit log to CSV',
      'Report',
      'rpt_audit_export',
      'Audit trail — last 30 days',
      { rows: 1284, format: 'CSV' },
    ],
    [
      5,
      'usr_adeyemi',
      'Exported report to PDF',
      'Report',
      'upcoming-hearings',
      'Upcoming hearings (next 30 days)',
      { format: 'PDF', rows: 24 },
    ],
    [
      9,
      'usr_okonkwo',
      'Updated role permissions',
      'Role',
      'CASE_OFFICER',
      'Case Officer / Clerk',
      { granted: 'courtdate.outcome.record', revoked: 'document.delete' },
    ],
    [
      13,
      'usr_okonkwo',
      'Invited user',
      'User',
      'usr_invited',
      'Barr. Halima Yusuf',
      { role: 'LEGAL_STAFF', invitationExpiresInDays: 7 },
    ],
    [
      21,
      'usr_sysadmin',
      'Updated system configuration',
      'Configuration',
      'cfg_session',
      'Session timeout',
      { from: '20 minutes', to: '30 minutes' },
    ],
    [
      26,
      'usr_sysadmin',
      'Added court to the register',
      'Configuration',
      'crt_cca_rs',
      'Customary Court of Appeal, Rivers State',
      { tier: 'Court of Appeal', state: 'Rivers' },
    ],
    [
      33,
      'usr_okonkwo',
      'Disabled user account',
      'User',
      'usr_counsel_dormant',
      'Barr. Ifeanyi Uche',
      { reason: 'brief concluded — access no longer required' },
    ],
    [
      38,
      'usr_sysadmin',
      'Bulk imported users from CSV',
      'User',
      'imp_2026_04',
      'Legal Unit staff import',
      { created: 6, skipped: 2, failed: 0 },
    ],
    [
      46,
      'usr_okonkwo',
      'Updated retention policy',
      'Configuration',
      'cfg_retention',
      'Archive concluded matters',
      { from: '5 years', to: '7 years' },
    ],
    [
      52,
      'usr_sysadmin',
      'Ran manual backup',
      'Backup',
      'bkp_manual_1',
      'Pre-upgrade full backup',
      { sizeGb: 42.6, scope: 'Both' },
    ],
    [
      61,
      'usr_adeyemi',
      'Exported case register to CSV',
      'Report',
      'caseload-by-status',
      'Caseload by status',
      { format: 'CSV', rows: 35 },
    ],
    [
      70,
      'usr_okonkwo',
      'Enabled multi-factor authentication requirement',
      'Configuration',
      'cfg_mfa',
      'MFA required for privileged roles',
      { roles: 'SUPER_ADMIN, ADMIN' },
    ],
  ];

  return rows.map(([hours, actorId, action, entity, entityId, entityLabel, metadata], index) => ({
    id: `aud_admin_${index + 1}`,
    at: hoursBefore(now, hours),
    actorId,
    action,
    entity,
    entityId,
    entityLabel,
    ipAddress: index % 2 === 0 ? '105.112.44.18' : '197.210.29.101',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36',
    outcome: 'success',
    metadata,
  }));
}
