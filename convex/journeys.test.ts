import { convexTest } from 'convex-test';
import type { FunctionArgs } from 'convex/server';
import { describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { DEFAULT_PERMISSION_MATRIX } from './shared/permissions';
import type { Role } from './shared/enums';
import { PDFDocument } from 'pdf-lib';

/**
 * HYPREP LCMS - end-to-end journeys.
 *
 * Every other test in this repository takes one unit and proves a property of it
 * in isolation. This file does the opposite: it drives the deployment the way the
 * Legal Unit drives it, in order, through the real public function surface, and
 * asserts on what the *next* step can see. A matter is filed, staff are attached
 * to it, a sitting is diarised and moved, an outcome is recorded and carries the
 * matter's status with it, documents are filed and revised, tasks are assigned
 * and worked, notes are written - and at the end the register, the dashboard, the
 * six reports, search and the audit trail are all asked whether they agree about
 * what happened. Where they can disagree, they are made to.
 *
 * **Why in-memory.** `convexTest(schema)` stands up a fresh Convex backend per
 * test - real transactions, real validators, real index semantics, real rollback -
 * with no network and no deployment. Nothing here can reach, read or write the
 * running local deployment, which is the point: an end-to-end suite that mutated
 * the deployment it was run against would be unrunnable twice.
 *
 * **Why the public surface only.** `t.run` appears here for exactly two jobs -
 * seeding the world before the journey starts, and inspecting tables that have no
 * public read (`caseMembers`, `sentReminders`, `counters`). Everything a person
 * does goes through `t.query` / `t.mutation` under an identity, so a permission,
 * compliance or audit regression fails the journey rather than being stepped over.
 *
 * **Six identities, one register.** The cast below is one person per role. That is
 * what makes the negative assertions worth having: the same journey is replayed
 * from six vantage points, and the interesting result is usually what somebody
 * *cannot* see.
 *
 * **Mutation-testing discipline.** After this suite passes, break the
 * implementation deliberately - drop the `restrictedToUserIds` clause from
 * `canAccessCase`, return the compiled default from `permissionsForRole`, delete
 * the `followOnStatus` application in `recordOutcome`, stop clearing
 * `sentReminders` on reschedule - and confirm each one turns a named test red. A
 * journey suite that survives those edits is scenery.
 */

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

/**
 * One member of the Unit per role, keyed by what they do rather than by role, so
 * a test reads as a sentence about people. `subject` is what the harness signs in
 * as; the wrapper resolves it against `users.authUserId`, exactly as Better
 * Auth's token subject does in production.
 */
const CAST = {
  director: {
    subject: 'e2e_director',
    role: 'SUPER_ADMIN',
    fullName: 'Adaeze Okonkwo',
    title: 'Director of Legal Services',
    email: 'adaeze.okonkwo@hyprep.gov.ng',
    licence: 'SCN/2004/0117',
    firm: null,
  },
  registrar: {
    subject: 'e2e_registrar',
    role: 'ADMIN',
    fullName: 'Bashir Danladi',
    title: 'Head, Legal Unit',
    email: 'bashir.danladi@hyprep.gov.ng',
    licence: 'SCN/2009/0442',
    firm: null,
  },
  lawyer: {
    subject: 'e2e_lawyer',
    role: 'LEGAL_STAFF',
    fullName: 'Chidinma Eze',
    title: 'Senior Lawyer',
    email: 'chidinma.eze@hyprep.gov.ng',
    licence: 'SCN/2015/0913',
    firm: null,
  },
  officer: {
    subject: 'e2e_officer',
    role: 'CASE_OFFICER',
    fullName: 'Danjuma Bello',
    title: 'Case Officer',
    email: 'danjuma.bello@hyprep.gov.ng',
    licence: null,
    firm: null,
  },
  external: {
    subject: 'e2e_external',
    role: 'EXTERNAL_COUNSEL',
    fullName: 'Efe Oghene',
    title: 'Associate Counsel',
    email: 'efe.oghene@oghenechambers.ng',
    licence: 'SCN/2011/0288',
    firm: 'Oghene Chambers',
  },
  observer: {
    subject: 'e2e_observer',
    role: 'READ_ONLY',
    fullName: 'Fatima Garba',
    title: 'Stakeholder',
    email: 'fatima.garba@hyprep.gov.ng',
    licence: null,
    firm: null,
  },
} as const;

describe('production safeguards: real files, tickets and record exports', () => {
  test('rejects metadata-only files and mismatched stored sizes without creating a record', async () => {
    const world = await seedWorld();
    const matter = await fileTheMatter(world);
    const input = await documentDraft(world, matter.id);
    await expect(world.as.lawyer.mutation(api.documents.finalizeUpload, { input: { ...input, storageId: null } })).rejects.toThrow('Upload the actual file');
    await expect(world.as.lawyer.mutation(api.documents.finalizeUpload, { input: { ...input, sizeBytes: input.sizeBytes + 1 } })).rejects.toThrow('Invalid file size');
    expect(await world.as.lawyer.query(api.documents.list, { caseId: matter.id })).toEqual([]);
  });

  test('rejects a replacement without file content and preserves the current version', async () => {
    const world = await seedWorld();
    const matter = await fileTheMatter(world);
    const filed = await world.as.lawyer.mutation(api.documents.finalizeUpload, { input: await documentDraft(world, matter.id) });
    await expect(world.as.lawyer.mutation(api.documents.addDocumentVersion, { id: filed.id, changeNote: 'Missing replacement', sizeBytes: 0, storageId: null, storageKey: '' })).rejects.toThrow('Upload the actual replacement file');
    expect((await world.as.lawyer.query(api.documents.get, { id: filed.id }))?.currentVersion).toBe(1);
  });

  test('watermarks the stored confidential PDF instead of exposing the original', async () => {
    const world = await seedWorld();
    const matter = await fileTheMatter(world);
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = new Uint8Array(await pdf.save());
    const storageId = await world.t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: 'application/pdf' })));
    const filed = await world.as.lawyer.mutation(api.documents.finalizeUpload, { input: await documentDraft(world, matter.id, { confidential: true, storageId, sizeBytes: bytes.byteLength }) });
    expect(await world.as.lawyer.query(api.documents.getSignedUrl, { id: filed.id })).toEqual({ url: null });
    const result = await world.as.lawyer.action(api.documents.downloadFile, { id: filed.id });
    expect(result.name).toBe('Statement of Claim-confidential.pdf');
    const token = result.url.split('/files/')[1]!;
    const ticket = await world.t.query(internal.documents.readFileTicket, { token });
    expect(ticket?.storageId).not.toBe(storageId);
    const copy = await world.t.run(async (ctx) => (await ctx.storage.get(ticket!.storageId))!.arrayBuffer());
    expect(new Uint8Array(copy)).not.toEqual(bytes);
    expect((await PDFDocument.load(copy)).getPageCount()).toBe(1);
  });

  test('withdraws file tickets when the user is disabled or access is removed', async () => {
    const world = await seedWorld();
    const matter = await fileTheMatter(world);
    const input = await documentDraft(world, matter.id);
    const token = 'ticket-access-test';
    await world.t.mutation(internal.documents.createFileTicket, { storageId: input.storageId!, userId: world.users.lawyer, authSessionId: 'journey-session-lawyer', caseId: matter.id, permission: 'document.download', name: input.name, token });
    expect(await world.t.query(internal.documents.readFileTicket, { token })).not.toBeNull();
    await world.t.run((ctx) => ctx.db.patch(world.users.lawyer, { status: 'disabled' }));
    expect(await world.t.query(internal.documents.readFileTicket, { token })).toBeNull();
    await world.t.run((ctx) => ctx.db.patch(world.users.lawyer, { status: 'active' }));
    await world.t.run((ctx) => ctx.db.patch(matter.id, { restrictedToUserIds: [world.users.director] }));
    expect(await world.t.query(internal.documents.readFileTicket, { token })).toBeNull();
  });

  test('withdraws file tickets for revoked sessions and expired links', async () => {
    const world = await seedWorld();
    const matter = await fileTheMatter(world);
    const input = await documentDraft(world, matter.id);
    await world.t.run((ctx) => ctx.db.insert('userSessions', { userId: world.users.lawyer, authSessionId: 'ticket-session', device: 'Desktop', browser: 'Test', ipAddress: '', location: '', startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), revokedAt: new Date().toISOString() }));
    await world.t.mutation(internal.documents.createFileTicket, { storageId: input.storageId!, userId: world.users.lawyer, authSessionId: 'ticket-session', caseId: matter.id, permission: 'document.download', name: input.name, token: 'revoked-session' });
    expect(await world.t.query(internal.documents.readFileTicket, { token: 'revoked-session' })).toBeNull();
    await world.t.run((ctx) => ctx.db.insert('fileTickets', { storageId: input.storageId!, userId: world.users.lawyer, authSessionId: null, caseId: matter.id, permission: 'document.download', name: input.name, token: 'expired-ticket', expiresAt: Date.now() - 1 }));
    expect(await world.t.query(internal.documents.readFileTicket, { token: 'expired-ticket' })).toBeNull();
  });

  test('refuses confidential office downloads until an approved PDF exists', async () => {
    const world = await seedWorld();
    const matter = await fileTheMatter(world);
    const filed = await world.as.lawyer.mutation(api.documents.finalizeUpload, { input: await documentDraft(world, matter.id, { format: 'docx', name: 'Advice.docx', confidential: true }) });
    await expect(world.as.lawyer.action(api.documents.downloadFile, { id: filed.id })).rejects.toThrow('approved PDF');
  });

  test('reads export pages through database queries instead of action database access', async () => {
    const world = await seedWorld();
    const first = await world.t.query(internal.backupDb.page, { table: 'users', paginationOpts: { numItems: 2, cursor: null } });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    const second = await world.t.query(internal.backupDb.page, { table: 'users', paginationOpts: { numItems: 2, cursor: first.continueCursor } });
    expect(second.page).toHaveLength(2);
    expect(second.page.map((user) => user._id)).not.toEqual(first.page.map((user) => user._id));
  });

  test('does not claim unsupported file-store or incremental backups succeeded', async () => {
    const world = await seedWorld();
    await expect(world.as.director.action(api.backup.runBackup, { scope: 'Both' })).rejects.toThrow('platform snapshot');
    await expect(world.as.director.action(api.backup.runBackup, { type: 'Incremental', scope: 'Database' })).rejects.toThrow('platform snapshot');
    expect(await world.t.run((ctx) => ctx.db.query('backups').collect())).toEqual([]);
  });

  test('denies archive downloads to non-administrators and revokes issued links', async () => {
    const world = await seedWorld();
    const storageId = await world.t.run((ctx) => ctx.storage.store(new Blob(['test archive'], { type: 'application/gzip' })));
    const backupId = await world.t.run((ctx) => ctx.db.insert('backups', { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), type: 'Full', scope: 'Database', sizeGb: 0.0001, location: 'Convex application-record export', status: 'completed', storageId, triggeredById: world.users.director, error: null }));
    await expect(world.as.observer.mutation(api.backupDb.downloadArchive, { id: backupId })).rejects.toThrow('Your role does not permit');
    const download = await world.as.director.mutation(api.backupDb.downloadArchive, { id: backupId });
    const token = download.url.split('/exports/')[1]!;
    expect((await world.t.query(internal.backupDb.readArchiveTicket, { token }))?.storageId).toBe(storageId);
    const session = await world.t.run((ctx) => ctx.db.query('userSessions').withIndex('by_authSessionId', (query) => query.eq('authSessionId', 'journey-session-director')).unique());
    await world.t.run((ctx) => ctx.db.patch(session!._id, { revokedAt: new Date().toISOString() }));
    expect(await world.t.query(internal.backupDb.readArchiveTicket, { token })).toBeNull();
  });

  test('refuses missing archives and download tickets without a session record', async () => {
    const world = await seedWorld();
    const backupId = await world.t.run((ctx) => ctx.db.insert('backups', { startedAt: new Date().toISOString(), completedAt: null, type: 'Full', scope: 'Database', sizeGb: 0, location: 'Unverified legacy job', status: 'completed', storageId: null, triggeredById: null, error: null }));
    await expect(world.as.director.mutation(api.backupDb.downloadArchive, { id: backupId })).rejects.toThrow('No completed archive');
    const matter = await fileTheMatter(world);
    const input = await documentDraft(world, matter.id);
    await world.t.mutation(internal.documents.createFileTicket, { storageId: input.storageId!, userId: world.users.lawyer, authSessionId: 'missing-session', caseId: matter.id, permission: 'document.download', name: input.name, token: 'missing-session-ticket' });
    expect(await world.t.query(internal.documents.readFileTicket, { token: 'missing-session-ticket' })).toBeNull();
  });

  test('revokes a preview when its document becomes confidential', async () => {
    const world = await seedWorld();
    const matter = await fileTheMatter(world);
    const filed = await world.as.lawyer.mutation(api.documents.finalizeUpload, { input: await documentDraft(world, matter.id) });
    const preview = await world.as.lawyer.mutation(api.documents.getPreviewUrl, { id: filed.id });
    const token = preview.url.split('/files/')[1]!;
    expect((await world.t.query(internal.documents.readFileTicket, { token }))?.inline).toBe(true);
    expect(await world.as.lawyer.query(api.documents.getSignedUrl, { id: filed.id })).toEqual({ url: null });
    await world.t.run((ctx) => ctx.db.patch(filed.id, { confidential: true }));
    expect(await world.t.query(internal.documents.readFileTicket, { token })).toBeNull();
  });

  test('rejects tokens without a session or with another account session', async () => {
    const world = await seedWorld();
    await expect(world.t.withIdentity({ subject: CAST.director.subject }).query(api.cases.list, {})).rejects.toThrow('no session');
    await expect(world.t.withIdentity({ subject: CAST.director.subject, sessionId: 'journey-session-lawyer' }).query(api.cases.list, {})).rejects.toThrow('cannot be verified');
  });

  test('allows archive downloads from the configured live website without extra environment setup', async () => {
    vi.stubEnv('SITE_URL', 'https://lcms.example.test');
    vi.stubEnv('FRONTEND_ORIGINS', undefined);
    try {
      const world = await seedWorld();
      const storageId = await world.t.run((ctx) => ctx.storage.store(new Blob(['Archive test'], { type: 'application/gzip' })));
      const backupId = await world.t.run((ctx) => ctx.db.insert('backups', { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), type: 'Full', scope: 'Database', sizeGb: 0.0001, location: 'Test archive', status: 'completed', storageId, triggeredById: world.users.director, error: null }));
      const download = await world.as.director.mutation(api.backupDb.downloadArchive, { id: backupId });
      const path = `/exports/${download.url.split('/exports/')[1]}`;
      const response = await world.t.fetch(path, { headers: { origin: 'https://lcms.example.test' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('https://lcms.example.test');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.text()).toBe('Archive test');
      const untrusted = await world.t.fetch(path, { headers: { origin: 'https://untrusted.example.test' } });
      expect(untrusted.headers.get('access-control-allow-origin')).toBeNull();
      const expired = await world.t.fetch(`/exports/${crypto.randomUUID()}`, { headers: { origin: 'https://lcms.example.test' } });
      expect(expired.status).toBe(403);
      expect(expired.headers.get('access-control-allow-origin')).toBe('https://lcms.example.test');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

type CastKey = keyof typeof CAST;
type Harness = ReturnType<typeof convexTest>;

interface World {
  t: Harness;
  /** The signed-in harness for each member of the cast. */
  as: Record<CastKey, Harness>;
  users: Record<CastKey, Id<'users'>>;
  courts: { federal: Id<'courts'>; appeal: Id<'courts'> };
  caseTypes: { environmental: Id<'caseTypes'>; contract: Id<'caseTypes'> };
  documentTypes: { process: Id<'documentTypes'>; evidence: Id<'documentTypes'> };
  teamId: Id<'teams'>;
}

// ---------------------------------------------------------------------------
// Dates
//
// `nowIso()` in the implementation reads the wall clock and convex-test does not
// freeze it, so every date here is expressed relative to the moment the test
// runs. Hard-coded ISO strings would make the diary, the overdue rollups and the
// report windows quietly wrong from one year to the next.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function isoInDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

/** Date-only form, which is what `filingDate` and `dueDate` carry. */
function dateInDays(days: number): string {
  return isoInDays(days).slice(0, 10);
}

/** The year `createCase` will stamp into the matter number. */
function currentYear(): string {
  return new Date().getUTCFullYear().toString();
}

// ---------------------------------------------------------------------------
// Seeding the world
// ---------------------------------------------------------------------------

/**
 * The settings singleton, in its *neutral* position.
 *
 * `passwordExpiryDays: 0` and `mfaRequiredForRoles: []` are deliberate: the
 * compliance gates are the subject of one journey and background noise in every
 * other, so they start switched off and the journey that cares switches them on.
 */
async function seedSettings(
  t: Harness,
  overrides: Partial<Doc<'settings'>> = {},
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('settings', {
      organisationName: 'HYPREP',
      unitName: 'Legal Services Unit',
      dateFormat: 'dd/MM/yyyy',
      timeZone: 'Africa/Lagos',
      currency: 'NGN',
      sessionTimeoutMinutes: 30,
      passwordExpiryDays: 0,
      passwordMinLength: 12,
      passwordRequireComplexity: true,
      maxFailedLoginAttempts: 5,
      mfaRequiredForRoles: [],
      reminderOffsetsHours: [168, 72, 24],
      digestFrequency: 'daily',
      retentionArchiveAfterYears: 7,
      storageQuotaGb: 500,
      storageUsedGb: 0,
      backupSchedule: 'daily',
      backupRetentionDays: 30,
      watermarkConfidentialDownloads: true,
      ocrEnabled: true,
      smsEnabled: true,
      ssoEnabled: false,
      retentionDeletionEnabled: false,
      ...overrides,
    });
  });
}

/**
 * Writes the runtime permission matrix from the shipped default.
 *
 * Seeded explicitly rather than left to `permissionsForRole`'s fallback, because
 * the fallback is the failure path. Every role-gated assertion in this file is
 * therefore reading the same table Admin -> Roles and Permissions writes, which is
 * what makes the runtime-revocation journey below meaningful.
 */
async function seedPermissionMatrix(t: Harness, updatedById: Id<'users'>): Promise<void> {
  await t.run(async (ctx) => {
    for (const [role, permissions] of Object.entries(DEFAULT_PERMISSION_MATRIX)) {
      await ctx.db.insert('permissionMatrix', {
        role: role as Role,
        permissions: [...permissions],
        updatedAt: isoInDays(-30),
        updatedById,
      });
    }
  });
}

/**
 * A whole configured deployment: settings, the runtime matrix, two courts, two
 * matter types, two document types, a tag, one team, and the six-person cast.
 *
 * Users are inserted before the team (the team names its lead) and their `teamId`
 * is patched afterwards, which is the same two-step the provisioning path takes.
 */
async function seedWorld(
  overrides: Partial<Doc<'settings'>> = {},
  userMfaEnabled = true,
): Promise<World> {
  const t = convexTest(schema);

  const users = {} as Record<CastKey, Id<'users'>>;
  await t.run(async (ctx) => {
    let index = 0;
    for (const key of Object.keys(CAST) as CastKey[]) {
      const person = CAST[key];
      index += 1;
      users[key] = await ctx.db.insert('users', {
        authUserId: person.subject,
        fullName: person.fullName,
        email: person.email,
        phone: `+23480300000${String(index).padStart(2, '0')}`,
        title: person.title,
        role: person.role,
        department: person.role === 'EXTERNAL_COUNSEL' ? 'External' : 'Legal Services',
        teamId: null,
        practisingLicenceNo: person.licence,
        firm: person.firm,
        avatarColor: '#0f766e',
        initials: person.fullName
          .split(' ')
          .map((part) => part[0])
          .join(''),
        status: 'active',
        mfaEnabled: userMfaEnabled,
        mfaRequired: false,
        failedLoginAttempts: 0,
        lastLoginAt: isoInDays(-1),
        createdAt: isoInDays(-200),
        passwordChangedAt: isoInDays(-10),
        lockedAt: null,
      });
    }
  });

  const teamId = await t.run(async (ctx) =>
    ctx.db.insert('teams', {
      name: 'Environmental Litigation Team',
      description: 'Handles remediation and oil-spill matters.',
      leadUserId: users.lawyer,
      memberIds: [users.lawyer, users.officer],
    }),
  );

  await t.run(async (ctx) => {
    for (const id of [users.lawyer, users.officer]) await ctx.db.patch(id, { teamId });
  });

  const courts = await t.run(async (ctx) => ({
    federal: await ctx.db.insert('courts', {
      slug: 'federal_high_court_port_harcourt',
      name: 'Federal High Court, Port Harcourt',
      tier: 'Federal High Court',
      division: 'Port Harcourt Judicial Division',
      state: 'Rivers',
      address: 'Moscow Road, Port Harcourt',
      active: true,
    }),
    appeal: await ctx.db.insert('courts', {
      slug: 'court_of_appeal_port_harcourt',
      name: 'Court of Appeal, Port Harcourt',
      tier: 'Court of Appeal',
      division: 'Port Harcourt Division',
      state: 'Rivers',
      address: 'Aba Road, Port Harcourt',
      active: true,
    }),
  }));

  const caseTypes = await t.run(async (ctx) => ({
    environmental: await ctx.db.insert('caseTypes', {
      slug: 'environmental_remediation',
      name: 'Environmental Remediation',
      description: 'Claims arising from hydrocarbon contamination.',
      category: 'Environmental',
      active: true,
    }),
    contract: await ctx.db.insert('caseTypes', {
      slug: 'contract_dispute',
      name: 'Contract Dispute',
      description: 'Breach of a remediation services contract.',
      category: 'Contract',
      active: true,
    }),
  }));

  const documentTypes = await t.run(async (ctx) => ({
    process: await ctx.db.insert('documentTypes', {
      slug: 'originating_process',
      name: 'Originating Process',
      group: 'Court Process',
      retentionYears: 10,
      requiresConfidentiality: false,
      active: true,
    }),
    evidence: await ctx.db.insert('documentTypes', {
      slug: 'field_report',
      name: 'Field Report',
      group: 'Evidence',
      retentionYears: 10,
      requiresConfidentiality: false,
      active: true,
    }),
  }));

  await t.run(async (ctx) => {
    await ctx.db.insert('tags', {
      slug: 'remediation',
      label: 'Remediation',
      color: '#0f766e',
      usageCount: 0,
    });
  });

  await seedSettings(t, overrides);
  await seedPermissionMatrix(t, users.director);

  const as = {} as Record<CastKey, Harness>;
  for (const key of Object.keys(CAST) as CastKey[]) {
    const sessionId = `journey-session-${key}`;
    await t.run((ctx) => ctx.db.insert('userSessions', { userId: users[key], authSessionId: sessionId, device: 'Desktop', browser: 'Test', ipAddress: '', location: '', startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), revokedAt: null }));
    as[key] = t.withIdentity({ subject: CAST[key].subject, sessionId });
  }

  return { t, as, users, courts, caseTypes, documentTypes, teamId };
}

// ---------------------------------------------------------------------------
// Input drafts
//
// Typed off the generated API rather than restated, so a field added to
// `caseInput` breaks this file at compile time instead of at run time. That is
// the whole reason the drafts are not plain object literals.
// ---------------------------------------------------------------------------

type CaseDraft = FunctionArgs<typeof api.cases.createCase>['input'];
type CourtDateDraft = FunctionArgs<typeof api.courtDates.createCourtDate>['input'];
type TaskDraft = FunctionArgs<typeof api.tasks.createTask>['input'];
type DocumentDraft = FunctionArgs<typeof api.documents.finalizeUpload>['input'];

function caseDraft(w: World, overrides: Partial<CaseDraft> = {}): CaseDraft {
  return {
    caseReference: 'HYPREP/LIT/OML-29',
    title: 'HYPREP v. Ogoni Delta Services Ltd',
    suitNumber: 'FHC/PH/CS/118/2026',
    courtId: w.courts.federal,
    caseTypeId: w.caseTypes.environmental,
    status: 'Filed',
    priority: 'High',
    filingDate: dateInDays(-120),
    claimValue: 480_000_000,
    matterOwnerId: w.users.lawyer,
    assigneeIds: [w.users.officer],
    externalCounselIds: [],
    stakeholderIds: [],
    teamId: w.teamId,
    parties: [
      {
        id: 'party-1',
        name: 'Hydrocarbon Pollution Remediation Project',
        role: 'Claimant',
        type: 'Government',
        email: 'legal@hyprep.gov.ng',
        phone: '+2348030000001',
        address: 'Abuja',
        representedBy: 'Chidinma Eze',
      },
      {
        id: 'party-2',
        name: 'Ogoni Delta Services Ltd',
        role: 'Respondent',
        type: 'Corporate',
        email: null,
        phone: null,
        address: 'Port Harcourt',
        representedBy: null,
      },
    ],
    relatedCases: [],
    tags: ['Remediation'],
    confidential: false,
    restrictedToUserIds: [],
    summary: 'Claim for the cost of remediating hydrocarbon contamination at OML 29.',
    reliefSought: 'Special damages of NGN 480,000,000 and an order for site remediation.',
    presidingJudge: 'Hon. Justice A. M. Liman',
    ...overrides,
  };
}

function hearingDraft(
  w: World,
  caseId: Id<'cases'>,
  overrides: Partial<CourtDateDraft> = {},
): CourtDateDraft {
  return {
    caseId,
    startsAt: isoInDays(14),
    durationMinutes: 90,
    courtId: w.courts.federal,
    courtRoom: 'Court 3',
    judge: 'Hon. Justice A. M. Liman',
    purpose: 'Hearing',
    notes: 'Cross-examination of the second claimant witness.',
    attendeeIds: [w.users.lawyer, w.users.officer],
    reminderOffsetsHours: [168, 24],
    ...overrides,
  };
}

function taskDraft(
  w: World,
  caseId: Id<'cases'> | null,
  overrides: Partial<TaskDraft> = {},
): TaskDraft {
  return {
    caseId,
    title: 'Draft and file the written address',
    description: 'Final written address, with the list of authorities.',
    ownerId: w.users.lawyer,
    assignedTeamId: w.teamId,
    dueDate: dateInDays(7),
    priority: 'High',
    checklist: [
      { id: 'step-1', label: 'Settle the issues for determination', done: false },
      { id: 'step-2', label: 'Compile the list of authorities', done: false },
    ],
    attachmentDocumentIds: [],
    workflowTemplateId: null,
    ...overrides,
  };
}

async function documentDraft(
  w: World,
  caseId: Id<'cases'>,
  overrides: Partial<DocumentDraft> = {},
): Promise<DocumentDraft> {
  return {
    caseId,
    name: 'Statement of Claim.pdf',
    documentTypeId: w.documentTypes.process,
    format: 'pdf',
    confidential: false,
    tags: ['Remediation'],
    description: 'Originating process as filed at the registry.',
    sizeBytes: 245_760,
    storageId: await w.t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(245_760)], { type: 'application/pdf' }))),
    storageKey: 'cases/oml-29/statement-of-claim.pdf',
    ...overrides,
  };
}

/** Files the standing matter and returns both of its identifiers. */
async function fileTheMatter(
  w: World,
  overrides: Partial<CaseDraft> = {},
  by: Harness = w.as.director,
): Promise<{ id: Id<'cases'>; caseId: string }> {
  return await by.mutation(api.cases.createCase, { input: caseDraft(w, overrides) });
}

// ===========================================================================
// Journey 1 - standing up the deployment
//
// Configuration comes before litigation: a matter cannot be filed until a court
// and a matter type exist to file it in. This journey is the administrator's
// first hour, and it is also where the two administrative permissions are shown
// to be genuinely different (`config.manage` is the registrar's, `system.manage`
// is the director's alone).
// ===========================================================================

describe('journey: standing up the deployment', () => {
  test('the registrar configures the reference tables and everyone can read them', async () => {
    const w = await seedWorld();

    const court = await w.as.registrar.mutation(api.admin.upsertCourt, {
      input: {
        id: null,
        name: 'National Industrial Court, Port Harcourt',
        tier: 'National Industrial Court',
        division: 'Port Harcourt Division',
        state: 'Rivers',
        address: 'Olu Obasanjo Road',
        active: true,
      },
    });
    const caseType = await w.as.registrar.mutation(api.admin.upsertCaseType, {
      input: {
        id: null,
        name: 'Community Compensation',
        description: 'Compensation claims brought by host communities.',
        category: 'Civil',
        active: true,
      },
    });
    const documentType = await w.as.registrar.mutation(api.admin.upsertDocumentType, {
      input: {
        id: null,
        name: 'Witness Statement on Oath',
        group: 'Evidence',
        retentionYears: 10,
        requiresConfidentiality: false,
        active: true,
      },
    });
    const tag = await w.as.registrar.mutation(api.admin.upsertTag, {
      input: { id: null, label: 'Host Community', color: '#b45309' },
    });

    // `reference.bundle` is unpermissioned, so the pickers of every role see the
    // configuration the registrar just wrote.
    const bundle = await w.as.observer.query(api.reference.bundle, {});
    expect(bundle.courts.map((row) => row.id)).toContain(court.id);
    expect(bundle.caseTypes.map((row) => row.id)).toContain(caseType.id);
    expect(bundle.documentTypes.map((row) => row.id)).toContain(documentType.id);
    expect(bundle.tags.map((row) => row.id)).toContain(tag.id);

    // The slug is derived from the name, never accepted from the client.
    const slugs = await w.t.run(async (ctx) =>
      (await ctx.db.query('courts').collect()).map((row) => row.slug),
    );
    expect(slugs).toContain('national_industrial_court_port_harcourt');
  });

  test('an upsert with an id amends in place rather than duplicating', async () => {
    const w = await seedWorld();

    const first = await w.as.registrar.mutation(api.admin.upsertTag, {
      input: { id: null, label: 'Interlocutory', color: '#334155' },
    });
    const again = await w.as.registrar.mutation(api.admin.upsertTag, {
      input: { id: first.id, label: 'Interlocutory Appeal', color: '#1d4ed8' },
    });

    expect(again.id).toBe(first.id);
    const tags = await w.as.registrar.query(api.reference.bundle, {});
    expect(tags.tags.filter((row) => row.label.startsWith('Interlocutory'))).toHaveLength(1);
    expect(tags.tags.find((row) => row.id === first.id)?.label).toBe('Interlocutory Appeal');

    const removed = await w.as.registrar.mutation(api.admin.deleteTag, { id: first.id });
    expect(removed.deleted).toBe(true);
  });

  test('the bundle reports the caller their own permissions, per role', async () => {
    const w = await seedWorld();

    for (const key of Object.keys(CAST) as CastKey[]) {
      const bundle = await w.as[key].query(api.reference.bundle, {});
      expect([...bundle.permissions].sort()).toEqual(
        [...DEFAULT_PERMISSION_MATRIX[CAST[key].role]].sort(),
      );
    }
  });

  test('system settings are the director\u2019s alone; configuration is the registrar\u2019s too', async () => {
    const w = await seedWorld();

    await w.as.director.mutation(api.admin.updateSettings, {
      patch: { unitName: 'Legal Services Unit (Litigation)', storageQuotaGb: 750 },
    });
    const bundle = await w.as.director.query(api.reference.bundle, {});
    expect(bundle.settings.unitName).toBe('Legal Services Unit (Litigation)');
    expect(bundle.settings.storageQuotaGb).toBe(750);

    // ADMIN holds `config.manage` but not `system.manage`.
    await expect(
      w.as.registrar.mutation(api.admin.updateSettings, { patch: { storageQuotaGb: 10 } }),
    ).rejects.toThrow('(system.manage)');

    // LEGAL_STAFF holds neither.
    await expect(
      w.as.lawyer.mutation(api.admin.upsertTag, {
        input: { id: null, label: 'Unauthorised', color: '#000000' },
      }),
    ).rejects.toThrow('(config.manage)');
  });

  test('every configuration act lands in the audit trail as Configuration', async () => {
    const w = await seedWorld();

    await w.as.registrar.mutation(api.admin.upsertTag, {
      input: { id: null, label: 'Enforcement', color: '#7c3aed' },
    });
    await w.as.director.mutation(api.admin.updateSettings, { patch: { smsEnabled: false } });

    const trail = await w.as.director.query(api.audit.list, { entity: 'Configuration' });
    expect(trail.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['Saved tag', 'Updated system settings']),
    );
    expect(trail.rows.every((row) => row.outcome === 'success')).toBe(true);
    expect(trail.rows.map((row) => row.actorLabel)).toEqual(
      expect.arrayContaining([CAST.director.fullName, CAST.registrar.fullName]),
    );
  });
});

// ===========================================================================
// Journey 2 - filing a matter and attaching the people who work it
// ===========================================================================

describe('journey: filing a matter', () => {
  test('the matter number is allocated from the year counter, in sequence', async () => {
    const w = await seedWorld();
    const year = currentYear();

    const first = await fileTheMatter(w);
    const second = await fileTheMatter(w, { title: 'HYPREP v. Bonny Terminal Services' });

    expect(first.caseId).toBe(`HYP/LCMS/${year}/0001`);
    expect(second.caseId).toBe(`HYP/LCMS/${year}/0002`);

    // The counter is the mechanism, and it must have moved exactly twice.
    const counter = await w.t.run(async (ctx) =>
      ctx.db
        .query('counters')
        .withIndex('by_name', (q) => q.eq('name', `case:${year}`))
        .unique(),
    );
    expect(counter?.value).toBe(2);
  });

  test('the caseMembers projection is written from the four attachment lists', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w, {
      assigneeIds: [w.users.officer],
      externalCounselIds: [w.users.external],
      stakeholderIds: [w.users.observer],
    });

    const members = await w.t.run(async (ctx) =>
      ctx.db
        .query('caseMembers')
        .withIndex('by_case', (q) => q.eq('caseId', matter.id))
        .collect(),
    );

    expect(
      members.map((row) => `${row.userId}:${row.kind}`).sort(),
    ).toEqual(
      [
        `${w.users.lawyer}:owner`,
        `${w.users.officer}:assignee`,
        `${w.users.external}:counsel`,
        `${w.users.observer}:stakeholder`,
      ].sort(),
    );
  });

  test('the detail view carries the matter, its rollups and a created timeline entry', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);

    const detail = await w.as.lawyer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.row.record.caseId).toBe(matter.caseId);
    expect(detail.row.courtName).toBe('Federal High Court, Port Harcourt');
    expect(detail.row.courtTier).toBe('Federal High Court');
    expect(detail.row.caseTypeName).toBe('Environmental Remediation');
    expect(detail.row.owner?.id).toBe(w.users.lawyer);
    expect(detail.row.partiesLabel).toContain('Ogoni Delta Services Ltd');
    expect(detail.row.documentCount).toBe(0);
    expect(detail.row.openTasks).toBe(0);
    expect(detail.row.nextHearing).toBeNull();
    expect(detail.row.ageDays).toBeGreaterThanOrEqual(119);
    expect(detail.timeline.some((event) => event.type === 'case.created')).toBe(true);
  });

  test('an amendment rewrites the projection when the assignee changes', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);

    await w.as.lawyer.mutation(api.cases.updateCase, {
      caseId: matter.id,
      input: caseDraft(w, {
        assigneeIds: [w.users.registrar],
        priority: 'Critical',
        title: 'HYPREP v. Ogoni Delta Services Ltd (amended)',
      }),
    });

    const detail = await w.as.lawyer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.row.record.priority).toBe('Critical');
    expect(detail.row.record.title).toBe('HYPREP v. Ogoni Delta Services Ltd (amended)');
    expect(detail.row.record.assigneeIds).toEqual([w.users.registrar]);

    const kinds = await w.t.run(async (ctx) =>
      (
        await ctx.db
          .query('caseMembers')
          .withIndex('by_case', (q) => q.eq('caseId', matter.id))
          .collect()
      ).map((row) => `${row.userId}:${row.kind}`),
    );
    expect(kinds).toContain(`${w.users.registrar}:assignee`);
    expect(kinds).not.toContain(`${w.users.officer}:assignee`);
  });

  test('the register paginates, filters and sorts for a register-wide role', async () => {
    const w = await seedWorld();
    await fileTheMatter(w, { title: 'Alpha remediation claim', priority: 'Low' });
    await fileTheMatter(w, { title: 'Bravo remediation claim', priority: 'Critical' });
    await fileTheMatter(w, {
      title: 'Charlie remediation claim',
      priority: 'Medium',
      courtId: w.courts.appeal,
    });

    const all = await w.as.director.query(api.cases.list, { page: 1, pageSize: 2 });
    expect(all.total).toBe(3);
    expect(all.pageCount).toBe(2);
    expect(all.rows).toHaveLength(2);

    const critical = await w.as.director.query(api.cases.list, {
      filters: { priority: ['Critical'] },
    });
    expect(critical.rows.map((row) => row.record.title)).toEqual(['Bravo remediation claim']);

    const onAppeal = await w.as.director.query(api.cases.list, {
      filters: { courtIds: [w.courts.appeal] },
    });
    expect(onAppeal.rows.map((row) => row.record.title)).toEqual(['Charlie remediation claim']);

    const byTitle = await w.as.director.query(api.cases.list, {
      sort: { key: 'title', dir: 'desc' },
    });
    expect(byTitle.rows.map((row) => row.record.title)).toEqual([
      'Charlie remediation claim',
      'Bravo remediation claim',
      'Alpha remediation claim',
    ]);
  });

  test('archiving hides a matter from the register until it is asked for', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);

    await w.as.registrar.mutation(api.cases.archiveCase, { caseId: matter.id });

    const visible = await w.as.director.query(api.cases.list, {});
    expect(visible.rows.map((row) => row.record.id)).not.toContain(matter.id);

    const withArchived = await w.as.director.query(api.cases.list, {
      filters: { includeArchived: true },
    });
    const archived = withArchived.rows.find((row) => row.record.id === matter.id);
    expect(archived?.record.status).toBe('Archived');
    expect(archived?.record.archivedAt).not.toBeNull();
  });

  test('deleting a matter takes its access projection with it', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);

    await w.as.director.mutation(api.cases.deleteCase, { caseId: matter.id });

    const remaining = await w.t.run(async (ctx) => ({
      cases: await ctx.db.query('cases').collect(),
      members: await ctx.db.query('caseMembers').collect(),
    }));
    expect(remaining.cases).toHaveLength(0);
    expect(remaining.members).toHaveLength(0);

    await expect(
      w.as.director.query(api.cases.getDetail, { caseId: matter.id }),
    ).rejects.toThrow('Matter not found.');
  });
});

// ===========================================================================
// Journey 3 - the diary: scheduling, moving and reporting a sitting
//
// The status ladder in `lib/caseStatus.ts` is the part of the system a court
// clerk would notice breaking first: an outcome recorded on the sitting is what
// moves the matter, and nobody re-types the status by hand.
// ===========================================================================

describe('journey: the court diary', () => {
  test('a scheduled sitting becomes the next hearing on the matter', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);

    const sitting = await w.as.lawyer.mutation(api.courtDates.createCourtDate, {
      input: hearingDraft(w, matter.id),
    });

    const detail = await w.as.lawyer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.courtDates).toHaveLength(1);
    expect(detail.row.nextHearing?.id).toBe(sitting.id);
    expect(detail.row.nextHearing?.courtRoom).toBe('Court 3');
    expect(detail.row.nextHearing?.outcome).toBeNull();
  });

  test('the diary window filters by date', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);

    await w.as.lawyer.mutation(api.courtDates.createCourtDate, {
      input: hearingDraft(w, matter.id, { startsAt: isoInDays(3), purpose: 'Mention' }),
    });
    await w.as.lawyer.mutation(api.courtDates.createCourtDate, {
      input: hearingDraft(w, matter.id, { startsAt: isoInDays(45), purpose: 'Judgment' }),
    });

    const fortnight = await w.as.lawyer.query(api.courtDates.list, {
      from: isoInDays(0),
      to: isoInDays(14),
    });
    expect(fortnight.map((row) => row.purpose)).toEqual(['Mention']);

    const everything = await w.as.lawyer.query(api.courtDates.list, {});
    expect(everything.map((row) => row.purpose)).toEqual(['Mention', 'Judgment']);
  });

  test('rescheduling moves the sitting and discards the reminders already served', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    const sitting = await w.as.lawyer.mutation(api.courtDates.createCourtDate, {
      input: hearingDraft(w, matter.id),
    });

    // The reminder cron has already served the 168-hour offset for the old time.
    await w.t.run(async (ctx) => {
      await ctx.db.insert('sentReminders', {
        courtDateId: sitting.id,
        offsetHours: 168,
        sentAt: isoInDays(-1),
        channels: ['in_app', 'email'],
        recipientCount: 1,
      });
    });

    const moved = isoInDays(28);
    const result = await w.as.lawyer.mutation(api.courtDates.rescheduleCourtDate, {
      id: sitting.id,
      startsAt: moved,
    });
    expect(result.startsAt).toBe(moved);

    const reminders = await w.t.run(async (ctx) =>
      ctx.db
        .query('sentReminders')
        .withIndex('by_courtDate', (q) => q.eq('courtDateId', sitting.id))
        .collect(),
    );
    expect(reminders).toHaveLength(0);

    const detail = await w.as.lawyer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.row.nextHearing?.startsAt).toBe(moved);
  });
});

describe('journey: outcomes carry the matter', () => {
  test('an adjournment carries the matter to Adjourned and records why', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w, { status: 'Filed' });
    const sitting = await w.as.lawyer.mutation(api.courtDates.createCourtDate, {
      input: hearingDraft(w, matter.id, { startsAt: isoInDays(-2) }),
    });

    await w.as.lawyer.mutation(api.courtDates.recordOutcome, {
      id: sitting.id,
      outcome: 'Adjourned',
      notes: 'Adjourned at the instance of the respondent.',
    });

    const detail = await w.as.lawyer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.row.record.status).toBe('Adjourned');
    expect(detail.courtDates[0]?.outcome).toBe('Adjourned');
    expect(detail.courtDates[0]?.outcomeRecordedById).toBe(w.users.lawyer);
    expect(detail.statusChanges[0]).toMatchObject({
      from: 'Filed',
      to: 'Adjourned',
      reason: 'Outcome: Adjourned',
      byUserId: w.users.lawyer,
    });
    expect(detail.row.lastHearing?.id).toBe(sitting.id);
  });

  /**
   * The whole ladder in one table, including the two rungs that deliberately do
   * nothing. `Judgment Reserved` and `Not Sat` are the interesting cases: a
   * regression that made every outcome move the matter would still pass a test
   * that only checked the seven that do.
   */
  const LADDER = [
    { outcome: 'Heard', expected: 'Heard' },
    { outcome: 'Part-Heard', expected: 'Pending' },
    { outcome: 'Judgment Delivered', expected: 'Judgment Delivered' },
    { outcome: 'Ruling Delivered', expected: 'Pending' },
    { outcome: 'Settled', expected: 'Concluded' },
    { outcome: 'Struck Out', expected: 'Concluded' },
    { outcome: 'Judgment Reserved', expected: 'Filed' },
    { outcome: 'Not Sat', expected: 'Filed' },
  ] as const;

  test.each(LADDER)('%s leaves the matter at %s', async ({ outcome, expected }) => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w, { status: 'Filed' });
    const sitting = await w.as.lawyer.mutation(api.courtDates.createCourtDate, {
      input: hearingDraft(w, matter.id, { startsAt: isoInDays(-1) }),
    });

    await w.as.lawyer.mutation(api.courtDates.recordOutcome, {
      id: sitting.id,
      outcome,
      notes: `Recorded: ${outcome}`,
    });

    const detail = await w.as.lawyer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.row.record.status).toBe(expected);
    // A no-op rung must not manufacture a status-change row either.
    expect(detail.statusChanges).toHaveLength(expected === 'Filed' ? 0 : 1);
  });

  test('a case officer may diarise a sitting but not report its outcome', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);

    const sitting = await w.as.officer.mutation(api.courtDates.createCourtDate, {
      input: hearingDraft(w, matter.id, { startsAt: isoInDays(-1) }),
    });

    await expect(
      w.as.officer.mutation(api.courtDates.recordOutcome, {
        id: sitting.id,
        outcome: 'Heard',
        notes: 'Matter heard.',
      }),
    ).rejects.toThrow('(courtdate.outcome.record)');

    const after = await w.as.officer.query(api.courtDates.get, { id: sitting.id });
    expect(after?.outcome).toBeNull();
  });

  test('a status change written by hand is recorded with its stated reason', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w, { status: 'Draft' });

    await w.as.lawyer.mutation(api.cases.changeCaseStatus, {
      caseId: matter.id,
      to: 'Filed',
      reason: 'Originating process filed at the registry.',
    });

    const detail = await w.as.lawyer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.row.record.status).toBe('Filed');
    expect(detail.statusChanges[0]).toMatchObject({
      from: 'Draft',
      to: 'Filed',
      reason: 'Originating process filed at the registry.',
    });
  });
});

// ===========================================================================
// Journey 4 - the document file
//
// `finalizeUpload` schedules `internal.ocr.extract`. convex-test does not run
// scheduled functions unless asked to, and this suite deliberately never asks:
// the OCR worker talks to Google Cloud Vision, so the assertion here is that the
// document is *queued*, which is the state the requeue cron reads.
// ===========================================================================

describe('journey: the document file', () => {
  test('a filed document lands as version 1, queued for OCR, and bumps the rollup', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);

    const filed = await w.as.lawyer.mutation(api.documents.finalizeUpload, {
      input: await documentDraft(w, matter.id),
    });

    const rows = await w.as.lawyer.query(api.documents.list, { caseId: matter.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: filed.id,
      name: 'Statement of Claim.pdf',
      currentVersion: 1,
      authorId: w.users.lawyer,
      ocrStatus: 'queued',
      ocrText: null,
      checkedOutById: null,
    });
    expect(rows[0]?.versions).toHaveLength(1);
    expect(rows[0]?.versions[0]).toMatchObject({
      version: 1,
      changeNote: 'Initial filing',
      uploadedById: w.users.lawyer,
      sizeBytes: 245_760,
    });

    const detail = await w.as.lawyer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.row.documentCount).toBe(1);
    expect(detail.documents).toHaveLength(1);
  });

  test('a revised filing becomes version 2 without losing version 1', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    const filed = await w.as.lawyer.mutation(api.documents.finalizeUpload, {
      input: await documentDraft(w, matter.id),
    });

    await w.as.lawyer.mutation(api.documents.addDocumentVersion, {
      id: filed.id,
      changeNote: 'Amended to plead the second relief.',
      sizeBytes: 302_100,
      storageId: await w.t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(302_100)], { type: 'application/pdf' }))),
      storageKey: 'cases/oml-29/statement-of-claim-v2.pdf',
    });

    const document = await w.as.lawyer.query(api.documents.get, { id: filed.id });
    expect(document?.currentVersion).toBe(2);
    expect(document?.versions.map((version) => version.changeNote)).toEqual([
      'Initial filing',
      'Amended to plead the second relief.',
    ]);
    expect(document?.versions[1]?.sizeBytes).toBe(302_100);
  });

  test('checking a document out names the holder, and checking it back in clears them', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    const filed = await w.as.lawyer.mutation(api.documents.finalizeUpload, {
      input: await documentDraft(w, matter.id),
    });

    await w.as.lawyer.mutation(api.documents.toggleCheckOut, { id: filed.id });
    const out = await w.as.lawyer.query(api.documents.get, { id: filed.id });
    expect(out?.checkedOutById).toBe(w.users.lawyer);
    expect(out?.checkedOutAt).not.toBeNull();

    await w.as.lawyer.mutation(api.documents.toggleCheckOut, { id: filed.id });
    const back = await w.as.lawyer.query(api.documents.get, { id: filed.id });
    expect(back?.checkedOutById).toBeNull();
    expect(back?.checkedOutAt).toBeNull();
  });
});

describe('journey: who may touch the file', () => {
  test('a case officer may read the file but not manage its versions', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    const filed = await w.as.lawyer.mutation(api.documents.finalizeUpload, {
      input: await documentDraft(w, matter.id),
    });

    const visible = await w.as.officer.query(api.documents.list, { caseId: matter.id });
    expect(visible.map((row) => row.id)).toEqual([filed.id]);

    await expect(
      w.as.officer.mutation(api.documents.addDocumentVersion, {
        id: filed.id,
        changeNote: 'Officer edit',
        sizeBytes: 1_024,
        storageId: null,
        storageKey: 'cases/oml-29/officer-edit.pdf',
      }),
    ).rejects.toThrow('(document.version.manage)');

    const untouched = await w.as.lawyer.query(api.documents.get, { id: filed.id });
    expect(untouched?.currentVersion).toBe(1);
  });

  test('withdrawing a document needs the delete right and returns the rollup to zero', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    const filed = await w.as.lawyer.mutation(api.documents.finalizeUpload, {
      input: await documentDraft(w, matter.id),
    });

    await expect(
      w.as.lawyer.mutation(api.documents.deleteDocument, { id: filed.id }),
    ).rejects.toThrow('(document.delete)');

    await w.as.director.mutation(api.documents.deleteDocument, { id: filed.id });

    const rows = await w.as.director.query(api.documents.list, { caseId: matter.id });
    expect(rows).toHaveLength(0);
    const detail = await w.as.director.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.row.documentCount).toBe(0);
  });
});

// ===========================================================================
// Journey 5 - the task board
// ===========================================================================

describe('journey: the task board', () => {
  test('a new task opens Not Started whatever the caller asks for', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);

    const task = await w.as.lawyer.mutation(api.tasks.createTask, {
      input: taskDraft(w, matter.id),
    });

    const row = await w.as.lawyer.query(api.tasks.get, { id: task.id });
    expect(row).toMatchObject({
      status: 'Not Started',
      completedAt: null,
      ownerId: w.users.lawyer,
      createdById: w.users.lawyer,
      caseId: matter.id,
    });

    const detail = await w.as.lawyer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.row.openTasks).toBe(1);
  });

  test('completing a task stamps completedAt and reopening it clears the stamp', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    const task = await w.as.lawyer.mutation(api.tasks.createTask, {
      input: taskDraft(w, matter.id),
    });

    await w.as.lawyer.mutation(api.tasks.updateTask, {
      id: task.id,
      patch: { status: 'Completed' },
    });
    const done = await w.as.lawyer.query(api.tasks.get, { id: task.id });
    expect(done?.status).toBe('Completed');
    expect(done?.completedAt).not.toBeNull();

    await w.as.lawyer.mutation(api.tasks.updateTask, {
      id: task.id,
      patch: { status: 'In Progress' },
    });
    const reopened = await w.as.lawyer.query(api.tasks.get, { id: task.id });
    expect(reopened?.status).toBe('In Progress');
    expect(reopened?.completedAt).toBeNull();
  });

  test('reassigning a task moves it on the board without touching its history', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    const task = await w.as.lawyer.mutation(api.tasks.createTask, {
      input: taskDraft(w, matter.id),
    });

    await w.as.registrar.mutation(api.tasks.updateTask, {
      id: task.id,
      patch: { ownerId: w.users.officer, priority: 'Critical', dueDate: dateInDays(3) },
    });

    const mine = await w.as.registrar.query(api.tasks.list, { ownerId: w.users.officer });
    expect(mine.total).toBe(1);
    expect(mine.rows[0]).toMatchObject({
      id: task.id,
      ownerId: w.users.officer,
      priority: 'Critical',
      status: 'Not Started',
      createdById: w.users.lawyer,
    });
  });

  test('ticking a checklist item flips that item alone and leaves the task open', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    const task = await w.as.lawyer.mutation(api.tasks.createTask, {
      input: taskDraft(w, matter.id),
    });

    await w.as.officer.mutation(api.tasks.toggleChecklistItem, {
      taskId: task.id,
      itemId: 'step-1',
    });
    const half = await w.as.officer.query(api.tasks.get, { id: task.id });
    expect(half?.checklist.map((item) => item.done)).toEqual([true, false]);
    expect(half?.status).toBe('Not Started');

    await w.as.officer.mutation(api.tasks.toggleChecklistItem, {
      taskId: task.id,
      itemId: 'step-2',
    });
    const all = await w.as.officer.query(api.tasks.get, { id: task.id });
    expect(all?.checklist.map((item) => item.done)).toEqual([true, true]);

    // Every item ticked is not the same as the task being done: closing a task
    // is a deliberate act by someone holding `task.assign`.
    expect(all?.status).toBe('Not Started');
    expect(all?.completedAt).toBeNull();

    await w.as.officer.mutation(api.tasks.toggleChecklistItem, {
      taskId: task.id,
      itemId: 'step-1',
    });
    const undone = await w.as.officer.query(api.tasks.get, { id: task.id });
    expect(undone?.checklist.map((item) => item.done)).toEqual([false, true]);
  });
});

describe('journey: the Unit\u2019s own work', () => {
  test('a standalone task is the Unit\u2019s and its owner\u2019s, and nobody else\u2019s', async () => {
    const w = await seedWorld();

    const chore = await w.as.director.mutation(api.tasks.createTask, {
      input: taskDraft(w, null, {
        caseId: null,
        title: 'Quarterly retention review',
        ownerId: w.users.observer,
      }),
    });

    // The Unit (anyone holding `task.create`) sees the Unit's own work.
    for (const key of ['director', 'registrar', 'lawyer', 'officer'] as const) {
      const board = await w.as[key].query(api.tasks.list, {});
      expect(board.rows.map((row) => row.id)).toContain(chore.id);
    }

    // The owner sees their own task even without `task.create`.
    const owned = await w.as.observer.query(api.tasks.list, {});
    expect(owned.rows.map((row) => row.id)).toEqual([chore.id]);

    // External counsel holds `task.view` but neither owns this nor holds
    // `task.create`, so the Unit's internal chore is invisible to them.
    const outside = await w.as.external.query(api.tasks.list, {});
    expect(outside.rows).toHaveLength(0);
    expect(await w.as.external.query(api.tasks.get, { id: chore.id })).toBeNull();
  });

  test('a case officer may tick a task but not reassign one', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    const task = await w.as.lawyer.mutation(api.tasks.createTask, {
      input: taskDraft(w, matter.id),
    });

    await expect(
      w.as.officer.mutation(api.tasks.updateTask, {
        id: task.id,
        patch: { ownerId: w.users.officer },
      }),
    ).rejects.toThrow('(task.assign)');

    const unchanged = await w.as.officer.query(api.tasks.get, { id: task.id });
    expect(unchanged?.ownerId).toBe(w.users.lawyer);
  });

  test('the board filters by matter, status, priority and due date', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    const other = await fileTheMatter(w, { title: 'HYPREP v. Bonny Marine Ltd', suitNumber: null });

    const soon = await w.as.lawyer.mutation(api.tasks.createTask, {
      input: taskDraft(w, matter.id, { title: 'File the reply', dueDate: dateInDays(2) }),
    });
    const later = await w.as.lawyer.mutation(api.tasks.createTask, {
      input: taskDraft(w, matter.id, {
        title: 'Brief the expert',
        dueDate: dateInDays(30),
        priority: 'Low',
      }),
    });
    const elsewhere = await w.as.lawyer.mutation(api.tasks.createTask, {
      input: taskDraft(w, other.id, { title: 'Serve the writ', dueDate: dateInDays(5) }),
    });

    // Ordered by due date, not by insertion.
    const everything = await w.as.lawyer.query(api.tasks.list, {});
    expect(everything.rows.map((row) => row.id)).toEqual([soon.id, elsewhere.id, later.id]);

    const thisMatter = await w.as.lawyer.query(api.tasks.list, { caseId: matter.id });
    expect(thisMatter.rows.map((row) => row.id)).toEqual([soon.id, later.id]);

    const byPriority = await w.as.lawyer.query(api.tasks.list, { priority: ['Low'] });
    expect(byPriority.rows.map((row) => row.id)).toEqual([later.id]);

    await w.as.lawyer.mutation(api.tasks.updateTask, {
      id: soon.id,
      patch: { status: 'Completed' },
    });
    const open = await w.as.lawyer.query(api.tasks.list, {
      status: ['Not Started', 'In Progress'],
    });
    expect(open.rows.map((row) => row.id)).toEqual([elsewhere.id, later.id]);

    const dueThisWeek = await w.as.lawyer.query(api.tasks.list, { dueBefore: dateInDays(7) });
    expect(dueThisWeek.rows.map((row) => row.id)).toEqual([soon.id, elsewhere.id]);
  });
});

// ===========================================================================
// Journey 6 - notes, and who the internal ones are for
//
// The contract, stated in `convex/notes.ts`: "notes marked `internalOnly` are
// the Legal Unit's own, hidden from EXTERNAL_COUNSEL and READ_ONLY stakeholders
// even when they can otherwise see the matter ... enforced here on every read,
// never in the client."
//
// These tests assert that contract as written, on both read paths a client
// actually uses: `notes.list` and the detail bundle `cases.getDetail`.
// ===========================================================================

/** The standing matter with an outside counsel and a stakeholder attached. */
async function matterWithOutsiders(w: World) {
  const matter = await fileTheMatter(w, {
    externalCounselIds: [w.users.external],
    stakeholderIds: [w.users.observer],
  });

  await w.as.lawyer.mutation(api.notes.addNote, {
    caseId: matter.id,
    body: 'Counsel to be briefed on the settlement range before the next sitting.',
    internalOnly: false,
  });
  const confidentialNote = await w.as.lawyer.mutation(api.notes.addNote, {
    caseId: matter.id,
    body: 'Do not disclose: the Ministry will not authorise above N120m.',
    internalOnly: true,
  });

  return { matter, internalNoteId: confidentialNote.id };
}

describe('journey: notes and the internal-only line', () => {
  test('the Legal Unit sees every note on the matter', async () => {
    const w = await seedWorld();
    const { matter, internalNoteId } = await matterWithOutsiders(w);

    const seen = await w.as.lawyer.query(api.notes.list, { caseId: matter.id });
    expect(seen.notes).toHaveLength(2);
    expect(seen.hiddenInternalCount).toBe(0);
    expect(seen.notes.map((note) => note.id)).toContain(internalNoteId);
    // Newest first.
    expect(seen.notes[0]?.internalOnly).toBe(true);

    const detail = await w.as.lawyer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.notes).toHaveLength(2);
  });

  test('a read-only stakeholder has no note surface of their own', async () => {
    const w = await seedWorld();
    const { matter } = await matterWithOutsiders(w);

    // READ_ONLY does not hold `note.create`, so the note list is closed to them
    // outright; the detail bundle is their only route to notes.
    await expect(
      w.as.observer.query(api.notes.list, { caseId: matter.id }),
    ).rejects.toThrow('(note.create)');

    await expect(
      w.as.observer.mutation(api.notes.addNote, {
        caseId: matter.id,
        body: 'A stakeholder comment.',
        internalOnly: false,
      }),
    ).rejects.toThrow('(note.create)');
  });

  test('external counsel does not see the internal notes on their own matter', async () => {
    const w = await seedWorld();
    const { matter, internalNoteId } = await matterWithOutsiders(w);

    const seen = await w.as.external.query(api.notes.list, { caseId: matter.id });
    expect(seen.notes.map((note) => note.id)).not.toContain(internalNoteId);
    expect(seen.notes).toHaveLength(1);
    expect(seen.hiddenInternalCount).toBe(1);
  });

  test('the detail bundle withholds internal notes from external counsel', async () => {
    const w = await seedWorld();
    const { matter, internalNoteId } = await matterWithOutsiders(w);

    const detail = await w.as.external.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.notes.map((note) => note.id)).not.toContain(internalNoteId);
    expect(detail.notes).toHaveLength(1);
  });

  test('the detail bundle withholds internal notes from a read-only stakeholder', async () => {
    const w = await seedWorld();
    const { matter, internalNoteId } = await matterWithOutsiders(w);

    const detail = await w.as.observer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.notes.map((note) => note.id)).not.toContain(internalNoteId);
    expect(detail.notes).toHaveLength(1);
  });
});

// ===========================================================================
// Journey 7 - confidentiality and the restricted list
//
// The rule under test lives in `convex/lib/access.ts`. These journeys exercise
// it through the public surface, so they also prove the rule is actually reached
// by the register, the detail bundle and the child collections - not just that
// the predicate in isolation is correct.
// ===========================================================================

describe('journey: a confidential matter', () => {
  test('the register withholds it from a role without the capability', async () => {
    const w = await seedWorld();
    const secret = await fileTheMatter(w, {
      title: 'HYPREP v. Confidential Respondent',
      confidential: true,
      matterOwnerId: w.users.lawyer,
      assigneeIds: [],
    });

    // LEGAL_STAFF holds `case.confidential.view` and is the owner besides.
    const insider = await w.as.lawyer.query(api.cases.list, {});
    expect(insider.rows.map((row) => row.record.id)).toContain(secret.id);

    // CASE_OFFICER holds `case.view.all` but not `case.confidential.view`, and
    // is attached to nothing here: register-wide scope is not enough.
    const outsider = await w.as.officer.query(api.cases.list, {});
    expect(outsider.rows.map((row) => row.record.id)).not.toContain(secret.id);
    expect(outsider.total).toBe(0);

    await expect(
      w.as.officer.query(api.cases.getDetail, { caseId: secret.id }),
    ).rejects.toThrow('Matter not found.');
  });

  test('but the officer working the file keeps their access to it', async () => {
    const w = await seedWorld();
    const secret = await fileTheMatter(w, {
      title: 'HYPREP v. Confidential Respondent',
      confidential: true,
      assigneeIds: [w.users.officer],
    });

    // Membership is checked before the confidential gate, by design: briefing
    // someone onto a confidential matter must not produce a file they cannot
    // open.
    const detail = await w.as.officer.query(api.cases.getDetail, { caseId: secret.id });
    expect(detail.row.record.id).toBe(secret.id);
    expect(detail.row.record.confidential).toBe(true);
  });

  test('the confidentialOnly filter reports only what the caller may see', async () => {
    const w = await seedWorld();
    const open = await fileTheMatter(w, { title: 'HYPREP v. Open Respondent' });
    const secret = await fileTheMatter(w, {
      title: 'HYPREP v. Confidential Respondent',
      confidential: true,
      assigneeIds: [],
    });

    const seen = await w.as.registrar.query(api.cases.list, {
      filters: { confidentialOnly: true },
    });
    expect(seen.rows.map((row) => row.record.id)).toEqual([secret.id]);
    expect(seen.rows.map((row) => row.record.id)).not.toContain(open.id);

    const nothing = await w.as.officer.query(api.cases.list, {
      filters: { confidentialOnly: true },
    });
    expect(nothing.rows).toHaveLength(0);
  });
});

describe('journey: a matter locked to named users', () => {
  test('an allow-list excludes even the system owner', async () => {
    const w = await seedWorld();
    const locked = await fileTheMatter(w, {
      title: 'HYPREP v. Sealed Respondent',
      matterOwnerId: w.users.lawyer,
      assigneeIds: [],
      restrictedToUserIds: [w.users.lawyer],
    });

    const forTheLawyer = await w.as.lawyer.query(api.cases.getDetail, { caseId: locked.id });
    expect(forTheLawyer.row.record.id).toBe(locked.id);

    // SUPER_ADMIN: every permission in the matrix, and still excluded. An
    // explicit allow-list is the strongest statement the register can make.
    await expect(
      w.as.director.query(api.cases.getDetail, { caseId: locked.id }),
    ).rejects.toThrow('Matter not found.');
    const registerForTheDirector = await w.as.director.query(api.cases.list, {});
    expect(registerForTheDirector.rows.map((row) => row.record.id)).not.toContain(locked.id);
    expect(registerForTheDirector.total).toBe(0);

    await expect(
      w.as.registrar.query(api.cases.getDetail, { caseId: locked.id }),
    ).rejects.toThrow('Matter not found.');
  });

  test('being named on the allow-list is not itself a grant of access', async () => {
    const w = await seedWorld();
    // The observer is on the restricted list but attached to the matter in no
    // working capacity, and holds neither `case.view.all` nor the confidential
    // capability. The list does not exclude them; nothing grants them either.
    const locked = await fileTheMatter(w, {
      title: 'HYPREP v. Sealed Respondent',
      matterOwnerId: w.users.lawyer,
      assigneeIds: [],
      restrictedToUserIds: [w.users.lawyer, w.users.observer],
    });

    await expect(
      w.as.observer.query(api.cases.getDetail, { caseId: locked.id }),
    ).rejects.toThrow('Matter not found.');

    // The projection records the lock so "who is this locked down to" is
    // answerable, but a `restricted` row is never a grant.
    const rows = await w.t.run(async (ctx) =>
      ctx.db
        .query('caseMembers')
        .withIndex('by_user', (q) => q.eq('userId', w.users.observer))
        .collect(),
    );
    expect(rows.map((row) => row.kind)).toEqual(['restricted']);
  });

  test('the lock reaches the child collections too', async () => {
    const w = await seedWorld();
    const locked = await fileTheMatter(w, {
      matterOwnerId: w.users.lawyer,
      assigneeIds: [],
      restrictedToUserIds: [w.users.lawyer],
    });
    const filed = await w.as.lawyer.mutation(api.documents.finalizeUpload, {
      input: await documentDraft(w, locked.id),
    });
    const task = await w.as.lawyer.mutation(api.tasks.createTask, {
      input: taskDraft(w, locked.id),
    });
    const sitting = await w.as.lawyer.mutation(api.courtDates.createCourtDate, {
      input: hearingDraft(w, locked.id, { attendeeIds: [w.users.lawyer] }),
    });

    expect(await w.as.director.query(api.documents.list, {})).toHaveLength(0);
    expect((await w.as.director.query(api.tasks.list, {})).rows).toHaveLength(0);

    const diary = await w.as.director.query(api.courtDates.list, {});
    expect(diary.map((row) => row.id)).not.toContain(sitting.id);

    // A case-bound child of an invisible matter is refused exactly the way the
    // matter itself is: indistinguishable from "no such record".
    await expect(
      w.as.director.query(api.documents.get, { id: filed.id }),
    ).rejects.toThrow('Matter not found.');
    await expect(
      w.as.director.query(api.tasks.get, { id: task.id }),
    ).rejects.toThrow('Matter not found.');
  });
});

// ===========================================================================
// Journey 8 - roles, and the matrix at runtime
//
// `permissionsForRole` reads the `permissionMatrix` table, not the compiled
// default, so an edit in Admin -> Roles and Permissions takes effect on the very
// next call. These journeys prove that, in both directions.
// ===========================================================================

describe('journey: roles decide what a caller may do', () => {
  test('a read-only stakeholder may open their matter and change nothing', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w, { stakeholderIds: [w.users.observer] });

    const detail = await w.as.observer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.row.record.id).toBe(matter.id);

    await expect(
      w.as.observer.mutation(api.cases.createCase, { input: caseDraft(w) }),
    ).rejects.toThrow('(case.create)');

    await expect(
      w.as.observer.mutation(api.cases.updateCase, {
        caseId: matter.id,
        input: caseDraft(w, { title: 'Renamed by a stakeholder' }),
      }),
    ).rejects.toThrow('(case.edit)');

    await expect(
      w.as.observer.mutation(api.documents.finalizeUpload, {
        input: await documentDraft(w, matter.id),
      }),
    ).rejects.toThrow('(document.upload)');
  });

  test('a case officer files and edits matters but does not move their status', async () => {
    const w = await seedWorld();
    const matter = await w.as.officer.mutation(api.cases.createCase, {
      input: caseDraft(w, { matterOwnerId: w.users.officer, assigneeIds: [] }),
    });

    await w.as.officer.mutation(api.cases.updateCase, {
      caseId: matter.id,
      input: caseDraft(w, {
        matterOwnerId: w.users.officer,
        assigneeIds: [],
        priority: 'Critical',
      }),
    });
    const amended = await w.as.officer.query(api.cases.getDetail, { caseId: matter.id });
    expect(amended.row.record.priority).toBe('Critical');

    await expect(
      w.as.officer.mutation(api.cases.changeCaseStatus, {
        caseId: matter.id,
        to: 'Concluded',
        reason: 'Officer closing the file.',
      }),
    ).rejects.toThrow('(case.status.change)');

    await expect(
      w.as.officer.mutation(api.cases.archiveCase, { caseId: matter.id }),
    ).rejects.toThrow('(case.archive)');

    await expect(
      w.as.officer.mutation(api.cases.deleteCase, { caseId: matter.id }),
    ).rejects.toThrow('(case.delete)');

    const untouched = await w.as.officer.query(api.cases.getDetail, { caseId: matter.id });
    expect(untouched.row.record.status).toBe('Filed');
  });

  test('external counsel is confined to their own brief', async () => {
    const w = await seedWorld();
    const briefed = await fileTheMatter(w, {
      title: 'HYPREP v. Briefed Respondent',
      externalCounselIds: [w.users.external],
    });
    const notBriefed = await fileTheMatter(w, {
      title: 'HYPREP v. Other Respondent',
      suitNumber: 'FHC/PH/CS/119/2026',
    });

    const brief = await w.as.external.query(api.cases.getDetail, { caseId: briefed.id });
    expect(brief.row.record.id).toBe(briefed.id);

    await expect(
      w.as.external.query(api.cases.getDetail, { caseId: notBriefed.id }),
    ).rejects.toThrow('Matter not found.');

    await expect(
      w.as.external.query(api.reports.run, { id: 'caseload-by-status' }),
    ).rejects.toThrow('(report.view)');
  });

  test('the register is the caseload for a role scoped to assigned matters', async () => {
    const w = await seedWorld();
    const briefed = await fileTheMatter(w, {
      title: 'HYPREP v. Briefed Respondent',
      externalCounselIds: [w.users.external],
    });
    await fileTheMatter(w, {
      title: 'HYPREP v. Other Respondent',
      suitNumber: 'FHC/PH/CS/119/2026',
    });

    // `cases.list` documents itself as the path a stakeholder uses ("a READ_ONLY
    // stakeholder scanning ten thousand matters does not scan ten thousand
    // matters"), and `visibleCaseIds` carries a branch for exactly the roles
    // that lack `case.view.all`. So the register must answer for those roles
    // with their own caseload.
    const register = await w.as.external.query(api.cases.list, {});
    expect(register.rows.map((row) => row.record.id)).toEqual([briefed.id]);
    expect(register.total).toBe(1);
  });
});

describe('journey: editing the matrix takes effect at once', () => {
  test('revoking a permission stops the very next call, and resetting restores it', async () => {
    const w = await seedWorld();
    const first = await fileTheMatter(w);
    const second = await fileTheMatter(w, { suitNumber: 'FHC/PH/CS/119/2026' });
    const third = await fileTheMatter(w, { suitNumber: 'FHC/PH/CS/120/2026' });

    // Before: the registrar (ADMIN) may archive.
    await w.as.registrar.mutation(api.cases.archiveCase, { caseId: first.id });

    const trimmed = DEFAULT_PERMISSION_MATRIX.ADMIN.filter(
      (permission) => permission !== 'case.archive',
    );
    await w.as.director.mutation(api.admin.setRolePermissions, {
      role: 'ADMIN',
      permissions: trimmed,
    });

    // The matrix row is the authority, so no restart and no re-login: the very
    // next call is refused.
    await expect(
      w.as.registrar.mutation(api.cases.archiveCase, { caseId: second.id }),
    ).rejects.toThrow('(case.archive)');

    const bundle = await w.as.registrar.query(api.reference.bundle, {});
    expect(bundle.permissions).not.toContain('case.archive');

    // And nothing happened to the matter.
    const untouched = await w.as.director.query(api.cases.getDetail, { caseId: second.id });
    expect(untouched.row.record.status).toBe('Filed');
    expect(untouched.row.record.archivedAt).toBeNull();

    await w.as.director.mutation(api.admin.resetRolePermissions, { role: 'ADMIN' });

    await w.as.registrar.mutation(api.cases.archiveCase, { caseId: third.id });
    const restored = await w.as.registrar.query(api.reference.bundle, {});
    expect([...restored.permissions].sort()).toEqual([...DEFAULT_PERMISSION_MATRIX.ADMIN].sort());
  });

  test('only a role manager may edit the matrix', async () => {
    const w = await seedWorld();

    await expect(
      w.as.registrar.mutation(api.admin.setRolePermissions, {
        role: 'READ_ONLY',
        permissions: [...DEFAULT_PERMISSION_MATRIX.SUPER_ADMIN],
      }),
    ).rejects.toThrow('(role.manage)');

    const stillReadOnly = await w.as.observer.query(api.reference.bundle, {});
    expect([...stillReadOnly.permissions].sort()).toEqual(
      [...DEFAULT_PERMISSION_MATRIX.READ_ONLY].sort(),
    );
  });

  test('a role granted a permission it does not normally hold may use it at once', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);

    await expect(
      w.as.officer.mutation(api.cases.changeCaseStatus, {
        caseId: matter.id,
        to: 'Pending',
        reason: 'Awaiting the court file.',
      }),
    ).rejects.toThrow('(case.status.change)');

    await w.as.director.mutation(api.admin.setRolePermissions, {
      role: 'CASE_OFFICER',
      permissions: [...DEFAULT_PERMISSION_MATRIX.CASE_OFFICER, 'case.status.change'],
    });

    await w.as.officer.mutation(api.cases.changeCaseStatus, {
      caseId: matter.id,
      to: 'Pending',
      reason: 'Awaiting the court file.',
    });

    const moved = await w.as.officer.query(api.cases.getDetail, { caseId: matter.id });
    expect(moved.row.record.status).toBe('Pending');
    expect(moved.statusChanges[0]).toMatchObject({
      from: 'Filed',
      to: 'Pending',
      byUserId: w.users.officer,
    });
  });
});

// ===========================================================================
// Journey 9 - the security obligations
//
// `authedMutation` refuses every write while a compliance obligation is
// outstanding; `authedQuery` does not. That asymmetry is deliberate - a user who
// owes an MFA enrolment must still be able to read enough of the app to reach the
// enrolment screen - and it is what these journeys pin down.
// ===========================================================================

describe('journey: an outstanding MFA enrolment', () => {
  test('stops the writes and leaves the reads alone', async () => {
    const w = await seedWorld({ mfaRequiredForRoles: ['LEGAL_STAFF'] }, false);
    const matter = await fileTheMatter(w);

    // The lawyer's role now requires two-factor and their account has not
    // enrolled, so every mutation is refused with the words that name the screen
    // which clears it.
    await expect(
      w.as.lawyer.mutation(api.cases.updateCase, {
        caseId: matter.id,
        input: caseDraft(w, { priority: 'Critical' }),
      }),
    ).rejects.toThrow('Two-factor authentication is required for your role.');

    await expect(
      w.as.lawyer.mutation(api.documents.finalizeUpload, {
        input: await documentDraft(w, matter.id),
      }),
    ).rejects.toThrow('Two-factor authentication is required for your role.');

    await expect(
      w.as.lawyer.mutation(api.notes.addNote, {
        caseId: matter.id,
        body: 'A note written while out of compliance.',
        internalOnly: true,
      }),
    ).rejects.toThrow('Two-factor authentication is required for your role.');

    // Reads are untouched: the obligation blocks changes, not access.
    const detail = await w.as.lawyer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.row.record.id).toBe(matter.id);
    expect(detail.row.record.priority).toBe('High');
    const register = await w.as.lawyer.query(api.cases.list, {});
    expect(register.total).toBe(1);

    // And it is this role's obligation, not everyone's.
    await w.as.registrar.mutation(api.cases.updateCase, {
      caseId: matter.id,
      input: caseDraft(w, { priority: 'Critical' }),
    });
  });

  test('enrolling discharges it and the next write goes through', async () => {
    const w = await seedWorld({ mfaRequiredForRoles: ['LEGAL_STAFF'] }, false);
    const matter = await fileTheMatter(w);

    await expect(
      w.as.lawyer.mutation(api.notes.addNote, {
        caseId: matter.id,
        body: 'Blocked.',
        internalOnly: false,
      }),
    ).rejects.toThrow('Two-factor authentication is required for your role.');

    // Enrolment itself runs through Better Auth, so the state it leaves behind is
    // set directly here: the point under test is that the gate reads the account
    // fresh on every call, not how the account came to be enrolled.
    await w.t.run(async (ctx) => {
      await ctx.db.patch(w.users.lawyer, { mfaEnabled: true });
    });

    await w.as.lawyer.mutation(api.notes.addNote, {
      caseId: matter.id,
      body: 'Written after enrolling.',
      internalOnly: false,
    });
    const notes = await w.as.lawyer.query(api.notes.list, { caseId: matter.id });
    expect(notes.notes.map((note) => note.body)).toEqual(['Written after enrolling.']);
  });

  test('an individual requirement binds one account, whatever the role rule says', async () => {
    const w = await seedWorld({}, false);
    const matter = await fileTheMatter(w);

    await w.as.director.mutation(api.users.setMfaRequired, {
      userId: w.users.lawyer,
      required: true,
    });

    await expect(
      w.as.lawyer.mutation(api.notes.addNote, {
        caseId: matter.id,
        body: 'Blocked by an individual requirement.',
        internalOnly: false,
      }),
    ).rejects.toThrow('Two-factor authentication is required for your role.');

    // The officer, same settings, no individual requirement: unaffected.
    await w.as.officer.mutation(api.notes.addNote, {
      caseId: matter.id,
      body: 'Unaffected.',
      internalOnly: false,
    });
  });
});

describe('journey: an expired password', () => {
  test('stops the writes until it is changed', async () => {
    const w = await seedWorld({ passwordExpiryDays: 90 });
    const matter = await fileTheMatter(w);

    await w.t.run(async (ctx) => {
      await ctx.db.patch(w.users.lawyer, { passwordChangedAt: isoInDays(-200) });
    });

    await expect(
      w.as.lawyer.mutation(api.notes.addNote, {
        caseId: matter.id,
        body: 'Written with an expired password.',
        internalOnly: false,
      }),
    ).rejects.toThrow('Your password has expired.');

    const detail = await w.as.lawyer.query(api.cases.getDetail, { caseId: matter.id });
    expect(detail.row.record.id).toBe(matter.id);

    await w.t.run(async (ctx) => {
      await ctx.db.patch(w.users.lawyer, { passwordChangedAt: isoInDays(-1) });
    });

    await w.as.lawyer.mutation(api.notes.addNote, {
      caseId: matter.id,
      body: 'Written after the change.',
      internalOnly: false,
    });
  });

  test('an account that has never set a password has nothing to expire', async () => {
    const w = await seedWorld({ passwordExpiryDays: 90 });
    const matter = await fileTheMatter(w);

    await w.t.run(async (ctx) => {
      await ctx.db.patch(w.users.lawyer, { passwordChangedAt: null });
    });

    await w.as.lawyer.mutation(api.notes.addNote, {
      caseId: matter.id,
      body: 'An SSO account writes freely.',
      internalOnly: false,
    });
  });
});

// ===========================================================================
// Journey 10 - the audit trail
//
// `authedMutation` writes the row itself and then checks the handler recorded
// one, so the trail is a property of the wrapper rather than something a handler
// remembers. These journeys read it back the way Admin -> Audit does.
// ===========================================================================

describe('journey: the trail records the work', () => {
  test('a full working day reads back newest first with every act in it', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    await w.as.lawyer.mutation(api.documents.finalizeUpload, {
      input: await documentDraft(w, matter.id),
    });
    const sitting = await w.as.lawyer.mutation(api.courtDates.createCourtDate, {
      input: hearingDraft(w, matter.id),
    });
    await w.as.lawyer.mutation(api.courtDates.recordOutcome, {
      id: sitting.id,
      outcome: 'Heard',
      notes: 'Claimant opened its case.',
    });

    const trail = await w.as.director.query(api.audit.list, {});
    const actions = trail.rows.map((row) => row.action);

    expect(actions).toContain('Created case');
    expect(actions).toContain('Filed document');
    expect(actions).toContain('Scheduled hearing');
    expect(actions).toContain('Recorded hearing outcome');

    // Newest first.
    const times = trail.rows.map((row) => row.at);
    expect([...times].sort((a, b) => b.localeCompare(a))).toEqual(times);

    // Every row names who acted, and carries the label the trail can still be
    // read by after the account is gone.
    for (const row of trail.rows) {
      expect(row.actorId).not.toBeNull();
      expect(row.actorLabel).not.toBe('');
      expect(row.outcome).toBe('success');
      // Written inside a transaction, where no network context exists.
      expect(row.ipAddress).toBeNull();
      expect(row.userAgent).toBeNull();
    }
  });

  test('the trail filters by entity, by actor and by action', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    await w.as.lawyer.mutation(api.documents.finalizeUpload, {
      input: await documentDraft(w, matter.id),
    });
    await w.as.officer.mutation(api.tasks.createTask, { input: taskDraft(w, matter.id) });

    const documents = await w.as.director.query(api.audit.list, { entity: 'Document' });
    expect(documents.rows).toHaveLength(1);
    expect(documents.rows[0]?.action).toBe('Filed document');
    expect(documents.rows[0]?.actorId).toBe(w.users.lawyer);

    const byOfficer = await w.as.director.query(api.audit.list, { actorId: w.users.officer });
    expect(byOfficer.rows.map((row) => row.entity)).toEqual(['Task']);

    const created = await w.as.director.query(api.audit.list, { actionContains: 'created' });
    expect(created.rows.map((row) => row.action).sort()).toEqual(['Created case', 'Created task']);

    const none = await w.as.director.query(api.audit.list, { entity: 'Role' });
    expect(none.rows).toHaveLength(0);
    expect(none.total).toBe(0);
    expect(none.pageCount).toBe(1);
  });

  test('the page size is bounded however large a page is asked for', async () => {
    const w = await seedWorld();
    for (let index = 0; index < 5; index += 1) {
      await fileTheMatter(w, { suitNumber: `FHC/PH/CS/${200 + index}/2026` });
    }

    const asked = await w.as.director.query(api.audit.list, { pageSize: 10_000 });
    expect(asked.pageSize).toBe(200);
    expect(asked.total).toBe(5);
    expect(asked.pageCount).toBe(1);

    const paged = await w.as.director.query(api.audit.list, { page: 2, pageSize: 2 });
    expect(paged.rows).toHaveLength(2);
    expect(paged.page).toBe(2);
    expect(paged.pageCount).toBe(3);

    // A page past the end is empty rather than an error.
    const past = await w.as.director.query(api.audit.list, { page: 9, pageSize: 2 });
    expect(past.rows).toHaveLength(0);
    expect(past.total).toBe(5);
  });

  test('a read worth recording is recorded, through the closed action enum', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    const filed = await w.as.lawyer.mutation(api.documents.finalizeUpload, {
      input: await documentDraft(w, matter.id),
    });

    await w.as.lawyer.mutation(api.audit.recordReadEvent, {
      action: 'document.downloaded',
      entityId: filed.id,
      entityLabel: 'Statement of Claim.pdf',
    });

    const downloads = await w.as.director.query(api.audit.list, {
      actionContains: 'document.downloaded',
    });
    expect(downloads.rows).toHaveLength(1);
    expect(downloads.rows[0]).toMatchObject({
      action: 'document.downloaded',
      entity: 'Document',
      entityId: filed.id,
      entityLabel: 'Statement of Claim.pdf',
      actorId: w.users.lawyer,
      metadata: { readAction: 'document.downloaded' },
    });
  });

  test('the trail is closed to a caller without the audit right', async () => {
    const w = await seedWorld();
    await fileTheMatter(w);

    await expect(w.as.observer.query(api.audit.list, {})).rejects.toThrow('(audit.view)');
    await expect(w.as.lawyer.query(api.audit.list, {})).rejects.toThrow('(audit.view)');
    await expect(w.as.external.query(api.audit.list, {})).rejects.toThrow('(audit.view)');

    // But recording a read event is open to any signed-in caller, because the
    // action it may record is a closed set.
    await w.as.observer.mutation(api.audit.recordReadEvent, {
      action: 'case.viewed',
      entityId: 'some-case',
      entityLabel: 'HYP/LCMS/2026/0001',
      entity: 'Case',
    });
  });
});

// ===========================================================================
// Journey 11 - what the Legal Unit reads back
//
// The dashboard and the six standard reports are aggregates over the *visible*
// register, computed server-side. These journeys build a small register with
// known contents and check the arithmetic, then check the same figures narrow
// with the caller.
// ===========================================================================

/** A register with known contents: three matters, one concluded, one hearing. */
async function aWorkingRegister(w: World) {
  const first = await fileTheMatter(w, {
    title: 'HYPREP v. Ogoni Delta Services Ltd',
    claimValue: 480_000_000,
  });
  const second = await fileTheMatter(w, {
    title: 'HYPREP v. Bonny Marine Ltd',
    suitNumber: 'FHC/PH/CS/119/2026',
    priority: 'Critical',
    claimValue: 120_000_000,
    filingDate: dateInDays(-400),
  });
  const third = await fileTheMatter(w, {
    title: 'HYPREP v. Kalabari Holdings Plc',
    suitNumber: 'FHC/PH/CS/120/2026',
    claimValue: 60_000_000,
    filingDate: dateInDays(-30),
  });

  await w.as.lawyer.mutation(api.courtDates.createCourtDate, {
    input: hearingDraft(w, first.id, { startsAt: isoInDays(3) }),
  });
  await w.as.lawyer.mutation(api.documents.finalizeUpload, {
    input: await documentDraft(w, first.id),
  });
  await w.as.lawyer.mutation(api.tasks.createTask, {
    input: taskDraft(w, first.id, { dueDate: dateInDays(2) }),
  });
  await w.as.lawyer.mutation(api.tasks.createTask, {
    input: taskDraft(w, second.id, { title: 'Overdue filing', dueDate: dateInDays(-5) }),
  });
  await w.as.director.mutation(api.cases.changeCaseStatus, {
    caseId: third.id,
    to: 'Concluded',
    reason: 'Terms of settlement entered as consent judgment.',
  });

  return { first, second, third };
}

describe('journey: the dashboard counts the visible register', () => {
  test('the figures add up over the whole register', async () => {
    const w = await seedWorld();
    await aWorkingRegister(w);

    const { metrics } = await w.as.director.query(api.dashboard.summary, {});

    expect(metrics.totalMatters).toBe(3);
    expect(metrics.activeMatters).toBe(2);
    expect(metrics.concludedMatters).toBe(1);
    expect(metrics.confidentialMatters).toBe(0);
    expect(metrics.documentCount).toBe(1);
    expect(metrics.totalExposure).toBe(660_000_000);

    expect(metrics.openTasks).toBe(2);
    expect(metrics.overdueTasks).toBe(1);

    expect(metrics.hearingsNext30.map((hearing) => hearing.caseNumber)).toEqual([
      'HYP/LCMS/' + currentYear() + '/0001',
    ]);
    expect(metrics.hearingsToday).toHaveLength(0);

    const byStatus = new Map(metrics.byStatus.map((row) => [row.status, row.count]));
    expect(byStatus.get('Filed')).toBe(2);
    expect(byStatus.get('Concluded')).toBe(1);

    const byPriority = new Map(metrics.byPriority.map((row) => [row.priority, row.count]));
    expect(byPriority.get('High')).toBe(2);
    expect(byPriority.get('Critical')).toBe(1);

    // Every bucket is reported, including the empty ones, so a chart has a
    // stable domain.
    expect(metrics.byAgeBucket.map((row) => row.bucket)).toEqual([
      '0-3 mo',
      '3-6 mo',
      '6-12 mo',
      '1-3 yrs',
      '3-5 yrs',
      '5+ yrs',
    ]);
    const byAge = new Map(metrics.byAgeBucket.map((row) => [row.bucket, row.count]));
    expect(byAge.get('0-3 mo')).toBe(1);
    expect(byAge.get('3-6 mo')).toBe(1);
    expect(byAge.get('1-3 yrs')).toBe(1);
  });

  test('my work is mine, not the register\u2019s', async () => {
    const w = await seedWorld();
    await aWorkingRegister(w);

    const forTheLawyer = await w.as.director.query(api.dashboard.summary, {});
    expect(forTheLawyer.myWork.myMatters).toBe(0);

    const mine = await w.as.lawyer.query(api.dashboard.summary, {});
    expect(mine.myWork.myMatters).toBe(3);
    expect(mine.myWork.myTasks.map((task) => task.title)).toEqual([
      'Overdue filing',
      'Draft and file the written address',
    ]);
    expect(mine.myWork.myOverdue.map((task) => task.title)).toEqual(['Overdue filing']);
    expect(mine.myWork.unread).toBe(0);
  });

  test('a confidential matter is missing from the figures of a caller who may not see it', async () => {
    const w = await seedWorld();
    await aWorkingRegister(w);
    await fileTheMatter(w, {
      title: 'HYPREP v. Confidential Respondent',
      suitNumber: 'FHC/PH/CS/121/2026',
      confidential: true,
      claimValue: 900_000_000,
      assigneeIds: [],
    });

    const forTheRegistrar = await w.as.director.query(api.dashboard.summary, {});
    expect(forTheRegistrar.metrics.totalMatters).toBe(4);
    expect(forTheRegistrar.metrics.confidentialMatters).toBe(1);
    expect(forTheRegistrar.metrics.totalExposure).toBe(1_560_000_000);

    // CASE_OFFICER: register-wide scope, no confidential capability. The card
    // reads a smaller register, and that is the correct answer for them.
    const forTheOfficer = await w.as.officer.query(api.dashboard.summary, {});
    expect(forTheOfficer.metrics.totalMatters).toBe(3);
    expect(forTheOfficer.metrics.confidentialMatters).toBe(0);
    expect(forTheOfficer.metrics.totalExposure).toBe(660_000_000);
  });
});

// ===========================================================================
// Journey 12 - the six standard reports
//
// The TOR names six reports. Each one is a projection over the *visible*
// register, so each one is two assertions in a trench coat: the arithmetic,
// and the boundary. `rows` is declared as an open object on the wire, so the
// cells are read through one small cast rather than six.
// ===========================================================================

type ReportRows = Array<Record<string, string | number>>;

describe('journey: the six standard reports', () => {
  test('caseload by status groups the register and shares out the exposure', async () => {
    const w = await seedWorld();
    await aWorkingRegister(w);

    const report = await w.as.director.query(api.reports.run, { id: 'caseload-by-status' });

    expect(report.id).toBe('caseload-by-status');
    expect(report.columns.map((column) => column.key)).toEqual([
      'status',
      'count',
      'share',
      'exposure',
    ]);
    expect(report.caption).toBe('3 matters across 2 statuses.');

    // Sorted by count, descending.
    expect(report.rows as ReportRows).toEqual([
      { status: 'Filed', count: 2, share: 66.7, exposure: 600_000_000 },
      { status: 'Concluded', count: 1, share: 33.3, exposure: 60_000_000 },
    ]);
  });

  test('upcoming hearings honours the window and drops a sitting once it has an outcome', async () => {
    const w = await seedWorld();
    const { first } = await aWorkingRegister(w);

    const wide = await w.as.director.query(api.reports.run, { id: 'upcoming-hearings' });
    expect(wide.caption).toBe('1 sittings diarised in the next 30 days.');
    expect((wide.rows as ReportRows)[0]!.caseId).toBe(first.caseId);
    expect((wide.rows as ReportRows)[0]!.purpose).toBe('Hearing');
    expect((wide.rows as ReportRows)[0]!.owner).toBe('Chidinma Eze');

    // The sitting is three days out, so a one-day window excludes it.
    const narrow = await w.as.director.query(api.reports.run, {
      id: 'upcoming-hearings',
      windowDays: 1,
    });
    expect(narrow.rows).toHaveLength(0);
    expect(narrow.caption).toBe('0 sittings diarised in the next 1 days.');

    // And a sitting that has been disposed of is no longer upcoming.
    const diary = await w.as.lawyer.query(api.courtDates.list, { caseId: first.id });
    await w.as.lawyer.mutation(api.courtDates.recordOutcome, {
      id: diary[0]!.id,
      outcome: 'Heard',
      notes: 'Matter heard; judgment reserved.',
    });
    const after = await w.as.director.query(api.reports.run, { id: 'upcoming-hearings' });
    expect(after.rows).toHaveLength(0);
  });

  test('age of matters counts open matters only, oldest first', async () => {
    const w = await seedWorld();
    await aWorkingRegister(w);

    const report = await w.as.director.query(api.reports.run, { id: 'age-of-matters' });
    const rows = report.rows as ReportRows;

    // The concluded matter is not on this report at all.
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.title)).toEqual([
      'HYPREP v. Bonny Marine Ltd',
      'HYPREP v. Ogoni Delta Services Ltd',
    ]);
    expect(rows[0]!.age).toBe(400);
    expect(rows[0]!.bucket).toBe('1-3 yrs');
    expect(rows[1]!.age).toBe(120);
    expect(rows[1]!.bucket).toBe('3-6 mo');
    expect(report.caption).toBe('2 open matters. Oldest: 1y 1mo.');
  });

  test('workload by lawyer carries the matters, the diary and the task board together', async () => {
    const w = await seedWorld();
    await aWorkingRegister(w);

    const report = await w.as.director.query(api.reports.run, { id: 'workload-by-lawyer' });
    const rows = report.rows as ReportRows;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      lawyer: 'Chidinma Eze',
      title: 'Senior Lawyer',
      openCases: 2,
      hearings30: 1,
      openTasks: 2,
      overdueTasks: 1,
      exposure: 660_000_000,
    });
    expect(report.caption).toBe('1 fee earners carrying 3 matters between them.');
  });

  test('the owner filter narrows the register the report is computed over', async () => {
    const w = await seedWorld();
    await aWorkingRegister(w);

    const mine = await w.as.director.query(api.reports.run, {
      id: 'workload-by-lawyer',
      ownerId: w.users.lawyer,
    });
    expect(mine.rows).toHaveLength(1);

    // Nobody's matters are owned by the case officer, so the report is empty
    // rather than wrong.
    const theirs = await w.as.director.query(api.reports.run, {
      id: 'workload-by-lawyer',
      ownerId: w.users.officer,
    });
    expect(theirs.rows).toHaveLength(0);
    expect(theirs.caption).toBe('0 fee earners carrying 0 matters between them.');
  });
});

describe('journey: the closing reports', () => {
  test('concluded matters lists what has come off the register', async () => {
    const w = await seedWorld();
    const { third } = await aWorkingRegister(w);

    const report = await w.as.director.query(api.reports.run, { id: 'concluded-matters' });
    const rows = report.rows as ReportRows;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.caseId).toBe(third.caseId);
    expect(rows[0]!.status).toBe('Concluded');
    expect(rows[0]!.court).toBe('Federal High Court, Port Harcourt');
    expect(rows[0]!.owner).toBe('Chidinma Eze');
    expect(rows[0]!.duration).toBe(30);
    expect(report.caption).toBe('1 matters concluded, closed or archived.');
  });

  test('the document inventory totals the stored bytes across versions', async () => {
    const w = await seedWorld();
    const { first } = await aWorkingRegister(w);

    // A second version on the same document: the inventory counts one row with
    // two versions, and the size column reports the latest.
    const filed = await w.as.lawyer.query(api.documents.list, { caseId: first.id });
    await w.as.lawyer.mutation(api.documents.addDocumentVersion, {
      id: filed[0]!.id,
      changeNote: 'Amended to plead the 2019 remediation certificate.',
      sizeBytes: 262_144,
      storageId: await w.t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(262_144)], { type: 'application/pdf' }))),
      storageKey: 'cases/oml-29/statement-of-claim-v2.pdf',
    });

    const report = await w.as.director.query(api.reports.run, { id: 'document-inventory' });
    const rows = report.rows as ReportRows;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Statement of Claim.pdf');
    expect(rows[0]!.caseId).toBe(first.caseId);
    expect(rows[0]!.type).toBe('Originating Process');
    expect(rows[0]!.versions).toBe(2);
    expect(rows[0]!.size).toBe(262_144);
    expect(rows[0]!.confidential).toBe('No');
    expect(report.caption).toBe('1 documents · 507904 bytes stored.');
  });

  test('a report is computed over the caller\u2019s register, not the whole one', async () => {
    const w = await seedWorld();
    await aWorkingRegister(w);
    // One matter the stakeholder is actually on.
    await fileTheMatter(w, {
      title: 'HYPREP v. Andoni Fisheries Cooperative',
      suitNumber: 'FHC/PH/CS/122/2026',
      claimValue: 15_000_000,
      stakeholderIds: [w.users.observer],
    });

    const wholeRegister = await w.as.director.query(api.reports.run, {
      id: 'caseload-by-status',
    });
    expect((wholeRegister.rows as ReportRows).reduce((sum, row) => sum + (row.count as number), 0)).toBe(
      4,
    );

    // READ_ONLY holds `report.view` but not `case.view.all`, so the same report
    // resolves through the `caseMembers` projection: one matter, its own
    // exposure, and nothing about the other three.
    const stakeholderView = await w.as.observer.query(api.reports.run, {
      id: 'caseload-by-status',
    });
    expect(stakeholderView.rows as ReportRows).toEqual([
      { status: 'Filed', count: 1, share: 100, exposure: 15_000_000 },
    ]);
    expect(stakeholderView.caption).toBe('1 matters across 1 statuses.');
  });

  test('external counsel are refused the reporting surface outright', async () => {
    const w = await seedWorld();
    await aWorkingRegister(w);

    await expect(
      w.as.external.query(api.reports.run, { id: 'caseload-by-status' }),
    ).rejects.toThrow('(report.view)');
  });

  test('the case officer may read a report but the register still hides what they may not see', async () => {
    const w = await seedWorld();
    await aWorkingRegister(w);
    await fileTheMatter(w, {
      title: 'HYPREP v. Confidential Respondent',
      suitNumber: 'FHC/PH/CS/123/2026',
      confidential: true,
      claimValue: 900_000_000,
      assigneeIds: [],
    });

    const forTheOfficer = await w.as.officer.query(api.reports.run, { id: 'caseload-by-status' });
    const total = (forTheOfficer.rows as ReportRows).reduce(
      (sum, row) => sum + (row.count as number),
      0,
    );
    expect(total).toBe(3);

    const forTheDirector = await w.as.director.query(api.reports.run, {
      id: 'caseload-by-status',
    });
    expect(
      (forTheDirector.rows as ReportRows).reduce((sum, row) => sum + (row.count as number), 0),
    ).toBe(4);
  });
});

// ===========================================================================
// Journey 13 - finding things
//
// One box, six groups, and a visibility filter that runs before any of them.
// The interesting assertions here are the negative ones: a stakeholder must not
// be able to search their way to a matter they cannot open, or to the contents
// of an internal note.
// ===========================================================================

describe('journey: the search box', () => {
  test('a matter is found by its title, its suit number and the name of a party', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);

    const byTitle = await w.as.director.query(api.search.query, { query: 'Ogoni' });
    expect(byTitle.total).toBe(1);
    expect(byTitle.hits[0]).toMatchObject({
      group: 'Matters',
      id: matter.id,
      title: `${matter.caseId} — HYPREP v. Ogoni Delta Services Ltd`,
      subtitle: 'Filed',
      link: `/cases/${matter.id}`,
    });

    const bySuitNumber = await w.as.director.query(api.search.query, {
      query: 'FHC/PH/CS/118',
    });
    expect(bySuitNumber.hits.map((hit) => hit.id)).toEqual([matter.id]);

    const byParty = await w.as.director.query(api.search.query, {
      query: 'Hydrocarbon Pollution Remediation Project',
    });
    expect(byParty.hits.map((hit) => hit.id)).toEqual([matter.id]);

    // Case is irrelevant to the match.
    const shouty = await w.as.director.query(api.search.query, { query: 'OGONI' });
    expect(shouty.hits.map((hit) => hit.id)).toEqual([matter.id]);
  });

  test('a query of fewer than two characters is not a search', async () => {
    const w = await seedWorld();
    await fileTheMatter(w);

    for (const query of ['', 'O', '  O  ', ' ']) {
      const empty = await w.as.director.query(api.search.query, { query });
      expect(empty).toEqual({ hits: [], total: 0 });
    }
  });

  test('the diary, the task board and the note trail are all searchable', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);

    await w.as.lawyer.mutation(api.courtDates.createCourtDate, {
      input: hearingDraft(w, matter.id),
    });
    await w.as.lawyer.mutation(api.tasks.createTask, { input: taskDraft(w, matter.id) });
    await w.as.lawyer.mutation(api.notes.addNote, {
      caseId: matter.id,
      body: 'The registry has confirmed the return date by telephone.',
      internalOnly: false,
    });

    const diary = await w.as.lawyer.query(api.search.query, { query: 'Cross-examination' });
    expect(diary.hits.map((hit) => hit.group)).toEqual(['Court dates']);
    expect(diary.hits[0]!.title).toBe('Hearing — Court 3');

    const board = await w.as.lawyer.query(api.search.query, { query: 'written address' });
    expect(board.hits.map((hit) => hit.group)).toEqual(['Tasks']);
    expect(board.hits[0]).toMatchObject({
      title: 'Draft and file the written address',
      subtitle: 'Not Started',
      link: `/cases/${matter.id}?tab=tasks`,
    });

    const trail = await w.as.lawyer.query(api.search.query, { query: 'by telephone' });
    expect(trail.hits.map((hit) => hit.group)).toEqual(['Notes']);
    expect(trail.hits[0]!.title).toBe('Case note');
  });

  test('one query can land in several groups at once', async () => {
    const w = await seedWorld();
    const matter = await fileTheMatter(w);
    await w.as.lawyer.mutation(api.courtDates.createCourtDate, {
      input: hearingDraft(w, matter.id),
    });

    // The presiding judge appears on the matter and on the sitting.
    const found = await w.as.director.query(api.search.query, { query: 'Liman' });
    expect(found.hits.map((hit) => hit.group)).toEqual(['Matters', 'Court dates']);
    expect(found.total).toBe(2);
  });

  test('the per-group cap is applied, and applied per group', async () => {
    const w = await seedWorld();
    await fileTheMatter(w);
    await fileTheMatter(w, { suitNumber: 'FHC/PH/CS/119/2026' });
    await fileTheMatter(w, { suitNumber: 'FHC/PH/CS/120/2026' });

    const capped = await w.as.director.query(api.search.query, {
      query: 'Ogoni',
      limitPerGroup: 1,
    });
    expect(capped.hits).toHaveLength(1);

    const uncapped = await w.as.director.query(api.search.query, { query: 'Ogoni' });
    expect(uncapped.hits).toHaveLength(3);
  });
});
