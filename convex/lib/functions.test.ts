import { convexTest } from 'convex-test';
import { anyApi, type ApiFromModules } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, test } from 'vitest';
import schema from '../schema';
import type { Doc, Id } from '../_generated/dataModel';
import { authedMutation, authedQuery } from './functions';
import { internal } from '../_generated/api';

/**
 * HYPREP LCMS - the function wrapper test.
 *
 * `convex/lib/functions.ts` makes four promises about every mutation in the
 * deployment: the caller is who they say they are, they hold the permission, they
 * are not behind on a security obligation, and the change is in the audit trail.
 * All four are enforced at runtime, which means none of them are checked by the
 * compiler and a regression in any of them is silent. The audit requirement is the
 * sharpest case - it is a counter and a throw, and if the throw stopped firing,
 * every mutation written afterwards would look fine and record nothing.
 *
 * So the probe functions below are defined *here*, in the test file, and exercised
 * through the real `t.mutation` path rather than by calling the wrapper's internals.
 * That is deliberate: it is the only way to prove that the `onSuccess` throw
 * actually rolls the transaction back, because rollback is a property of the Convex
 * runtime and not of any code in this repository.
 *
 * They live in a `.test.ts` file because Convex excludes that pattern from function
 * bundling while `convex-test`'s module glob (`convex/**\/*.*s`) includes it - so
 * these are callable in the test and absent from the deployment. A probe mutation
 * that shipped would be a genuine hole: `probeUnaudited` writes without a trail.
 */

// ---------------------------------------------------------------------------
// Probe functions - the wrapper, as a real mutation would use it
// ---------------------------------------------------------------------------

/** The ordinary case: does the work, records it. */
export const probeAudited = authedMutation({
  permission: 'config.manage',
  audit: { entity: 'Configuration', action: 'tag.created' },
  args: { label: v.string() },
  handler: async (ctx, { label }) => {
    const tagId = await ctx.db.insert('tags', {
      slug: label.toLowerCase(),
      label,
      color: '#0f766e',
      usageCount: 0,
    });
    await ctx.audit({ entityId: tagId, entityLabel: label });
    return tagId;
  },
});

/**
 * The mistake the wrapper exists to catch: a real write with no audit call.
 *
 * This is what a mutation looks like when someone forgets. The test asserts the
 * tag it inserts is not in the database afterwards.
 */
export const probeUnaudited = authedMutation({
  permission: 'config.manage',
  audit: { entity: 'Configuration', action: 'tag.created' },
  args: { label: v.string() },
  handler: async (ctx, { label }) => {
    await ctx.db.insert('tags', { slug: label.toLowerCase(), label, color: '#000', usageCount: 0 });
  },
});

/** The declared exemption. Commits with nothing in the trail, by design. */
export const probeSkipped = authedMutation({
  permission: 'config.manage',
  audit: { skip: 'Probe for the skip path; writes nothing worth recording.' },
  args: { label: v.string() },
  handler: async (ctx, { label }) => {
    return await ctx.db.insert('tags', {
      slug: label.toLowerCase(),
      label,
      color: '#000',
      usageCount: 0,
    });
  },
});

/** Contradicts itself: declares `skip`, then audits. */
export const probeSkippedButAudits = authedMutation({
  permission: 'config.manage',
  audit: { skip: 'Declared exempt.' },
  args: {},
  handler: async (ctx) => {
    await ctx.audit({ entityId: 'x', entityLabel: 'x' });
  },
});

/** Two rows from one act - archiving a matter and its documents, in miniature. */
export const probeTwoRows = authedMutation({
  permission: 'config.manage',
  audit: { entity: 'Configuration', action: 'tag.created' },
  args: {},
  handler: async (ctx) => {
    await ctx.audit({ entityId: 'a', entityLabel: 'First' });
    await ctx.audit({ entityId: 'b', entityLabel: 'Second', entity: 'Note' });
  },
});

/** Every overridable field of the draft, set. */
export const probeOverrides = authedMutation({
  permission: 'config.manage',
  audit: { entity: 'Configuration', action: 'tag.created' },
  args: {},
  handler: async (ctx) => {
    await ctx.audit({
      entityId: 'case_1',
      entityLabel: 'HYP/LCMS/2026/0001',
      entity: 'Case',
      action: 'case.archived',
      outcome: 'failure',
      metadata: { reason: 'probe', count: 2, forced: true },
    });
  },
});

/** Audits, then throws. Nothing may survive - not the write, not the row. */
export const probeThrowsAfterAudit = authedMutation({
  permission: 'config.manage',
  audit: { entity: 'Configuration', action: 'tag.created' },
  args: {},
  handler: async (ctx) => {
    await ctx.db.insert('tags', { slug: 'doomed', label: 'Doomed', color: '#000', usageCount: 0 });
    await ctx.audit({ entityId: 'doomed', entityLabel: 'Doomed' });
    throw new Error('Deliberate failure after auditing.');
  },
});

/** Open to any signed-in user - the notification-read shape. */
export const probeNoPermission = authedMutation({
  permission: null,
  audit: { skip: 'Probe for the permission-less path.' },
  args: {},
  handler: async (ctx) => ctx.actor.user.email,
});

/** The two mutations that resolve a compliance obligation must run during one. */
export const probeCompliancePermitted = authedMutation({
  permission: null,
  allowNonCompliant: true,
  audit: { entity: 'User', action: 'user.password.changed' },
  args: {},
  handler: async (ctx) => {
    await ctx.audit({ entityId: ctx.actor.user._id, entityLabel: ctx.actor.user.fullName });
  },
});

export const probeQuery = authedQuery({
  permission: 'config.manage',
  args: {},
  handler: async (ctx) => ({
    email: ctx.actor.user.email,
    permissions: ctx.actor.permissions.length,
    canManageConfig: ctx.actor.can('config.manage'),
  }),
});

export const probeOpenQuery = authedQuery({
  permission: null,
  args: {},
  handler: async (ctx) => ctx.actor.user.fullName,
});

/**
 * Function references for the probes.
 *
 * `anyApi` builds the path string; `ApiFromModules` supplies the argument and
 * return types, so a probe called with the wrong arguments is a compile error
 * here exactly as it would be for a real mutation. The deployment's generated
 * `api` cannot be used because the deployment does not contain these functions -
 * which is the point of putting them in a `.test.ts` file.
 */
type ProbeApi = ApiFromModules<{
  probes: {
    probeAudited: typeof probeAudited;
    probeUnaudited: typeof probeUnaudited;
    probeSkipped: typeof probeSkipped;
    probeSkippedButAudits: typeof probeSkippedButAudits;
    probeTwoRows: typeof probeTwoRows;
    probeOverrides: typeof probeOverrides;
    probeThrowsAfterAudit: typeof probeThrowsAfterAudit;
    probeNoPermission: typeof probeNoPermission;
    probeCompliancePermitted: typeof probeCompliancePermitted;
    probeQuery: typeof probeQuery;
    probeOpenQuery: typeof probeOpenQuery;
  };
}>['probes'];

const probe = anyApi['lib/functions.test'] as unknown as ProbeApi;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AUTH_SUBJECT = 'auth_probe_subject';

describe('session expiry enforcement', () => {
  test('rejects an expired session even if its activity is recent', async () => {
    const { t, as } = await setup({}, { sessionTimeoutMinutes: 0 });
    await t.run(async (ctx) => {
      const session = await ctx.db.query('userSessions').withIndex('by_authSessionId', (query) => query.eq('authSessionId', 'probe-session')).unique();
      await ctx.db.patch(session!._id, { expiresAt: Date.now() - 1 });
    });
    await expect(as.query(probe.probeOpenQuery, {})).rejects.toThrow(/session has expired/);
    await expect(as.mutation(probe.probeAudited, { label: 'Expired' })).rejects.toThrow(/session has expired/);
    expect(await tagRows(t)).toHaveLength(0);
  });

  test('ends old legacy sessions instead of accepting them indefinitely', async () => {
    const { t, as } = await setup({}, { sessionTimeoutMinutes: 0 });
    await t.run(async (ctx) => {
      const session = await ctx.db.query('userSessions').withIndex('by_authSessionId', (query) => query.eq('authSessionId', 'probe-session')).unique();
      await ctx.db.patch(session!._id, { startedAt: '2000-01-01T00:00:00.000Z' });
    });
    await expect(as.query(probe.probeOpenQuery, {})).rejects.toThrow(/session has expired/);
  });

  test('uses refreshed expiry without treating token renewal as user activity', async () => {
    const { t, as } = await setup({}, { sessionTimeoutMinutes: 0 });
    const expiry = Date.now() + 60_000;
    const before = await t.run((ctx) => ctx.db.query('userSessions').withIndex('by_authSessionId', (query) => query.eq('authSessionId', 'probe-session')).unique());
    await t.mutation(internal.authEvents.recordSessionRefreshed, { authUserId: AUTH_SUBJECT, authSessionId: 'probe-session', expiresAt: expiry });
    const refreshed = await t.run((ctx) => ctx.db.get(before!._id));
    expect(refreshed?.expiresAt).toBe(expiry);
    expect(refreshed?.lastSeenAt).toBe(before?.lastSeenAt);
    await expect(as.query(probe.probeOpenQuery, {})).resolves.toBeDefined();
  });

  test('refuses malformed activity timestamps when idle timeout is enabled', async () => {
    const { t, as } = await setup();
    await t.run(async (ctx) => {
      const session = await ctx.db.query('userSessions').withIndex('by_authSessionId', (query) => query.eq('authSessionId', 'probe-session')).unique();
      await ctx.db.patch(session!._id, { lastSeenAt: 'not-a-date' });
    });
    await expect(as.query(probe.probeOpenQuery, {})).rejects.toThrow(/inactivity/);
  });

  test('refresh does not resurrect a signed-out session', async () => {
    const { t, as } = await setup();
    await t.run(async (ctx) => {
      const session = await ctx.db.query('userSessions').withIndex('by_authSessionId', (query) => query.eq('authSessionId', 'probe-session')).unique();
      await ctx.db.patch(session!._id, { revokedAt: new Date().toISOString(), expiresAt: Date.now() - 1 });
    });
    await t.mutation(internal.authEvents.recordSessionRefreshed, { authUserId: AUTH_SUBJECT, authSessionId: 'probe-session', expiresAt: Date.now() + 60_000 });
    await expect(as.query(probe.probeOpenQuery, {})).rejects.toThrow(/signed out/);
  });
});

type UserOverrides = Partial<Doc<'users'>>;

async function seedUser(
  t: ReturnType<typeof convexTest>,
  overrides: UserOverrides = {},
): Promise<Id<'users'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('users', {
      authUserId: AUTH_SUBJECT,
      fullName: 'Adaeze Okonkwo',
      email: 'adaeze.okonkwo@hyprep.gov.ng',
      phone: '+2348030000001',
      title: 'Lawyer',
      role: 'SUPER_ADMIN',
      department: 'Legal Services',
      teamId: null,
      practisingLicenceNo: 'SCN/2015/0001',
      firm: null,
      avatarColor: '#0f766e',
      initials: 'AO',
      status: 'active',
      mfaEnabled: true,
      mfaRequired: false,
      failedLoginAttempts: 0,
      lastLoginAt: null,
      createdAt: '2026-01-05T09:00:00.000Z',
      passwordChangedAt: '2026-08-01T09:00:00.000Z',
      lockedAt: null,
      ...overrides,
    });
  });
}

/**
 * The settings singleton, with both TOR security rules switched off.
 *
 * `mfaRequiredForRoles: []` and `passwordExpiryDays: 0` are the neutral position:
 * tests that are not about compliance should not have to satisfy it, and the two
 * that are turn the relevant rule on explicitly.
 */
async function seedSettings(
  t: ReturnType<typeof convexTest>,
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

async function setup(userOverrides: UserOverrides = {}, settingsOverrides = {}) {
  const t = convexTest({ schema });
  const userId = await seedUser(t, userOverrides);
  await seedSettings(t, settingsOverrides);
  await t.run((ctx) => ctx.db.insert('userSessions', { userId, authSessionId: 'probe-session', device: 'Desktop', browser: 'Test', ipAddress: '', location: '', startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), revokedAt: null }));
  return { t, userId, as: t.withIdentity({ subject: AUTH_SUBJECT, sessionId: 'probe-session' }) };
}

async function auditRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => await ctx.db.query('auditLog').collect());
}

async function tagRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => await ctx.db.query('tags').collect());
}

// ---------------------------------------------------------------------------
// The audit requirement
// ---------------------------------------------------------------------------

describe('the audit requirement', () => {
  test('an audited mutation commits, and the row describes the act', async () => {
    const { t, as, userId } = await setup();

    await as.mutation(probe.probeAudited, { label: 'Oil Spill' });

    const rows = await auditRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: userId,
      // Denormalised, so the trail survives a rename or a removal.
      actorLabel: 'Adaeze Okonkwo',
      action: 'tag.created',
      entity: 'Configuration',
      entityLabel: 'Oil Spill',
      outcome: 'success',
      // Not invented. The prototype hardcoded one fixed IP on every entry;
      // a mutation genuinely does not know these, so it says so.
      ipAddress: null,
      userAgent: null,
      metadata: {},
    });
    expect(rows[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(await tagRows(t)).toHaveLength(1);
  });

  test('a mutation that forgets to audit is refused, and its write is rolled back', async () => {
    const { t, as } = await setup();

    await expect(as.mutation(probe.probeUnaudited, { label: 'Untraced' })).rejects.toThrow(
      /recorded no audit row/,
    );

    // The whole claim of the wrapper: not merely that it complains, but that the
    // change does not survive. An unaudited mutation cannot leave anything behind.
    expect(await tagRows(t)).toHaveLength(0);
    expect(await auditRows(t)).toHaveLength(0);
  });

  test('the refusal names the mutation, so the fix is obvious', async () => {
    const { as } = await setup();
    await expect(as.mutation(probe.probeUnaudited, { label: 'Untraced' })).rejects.toThrow(
      /Configuration\/tag\.created/,
    );
  });

  test('a declared exemption commits with nothing in the trail', async () => {
    const { t, as } = await setup();

    await as.mutation(probe.probeSkipped, { label: 'Exempt' });

    expect(await tagRows(t)).toHaveLength(1);
    expect(await auditRows(t)).toHaveLength(0);
  });

  test('a mutation cannot both declare itself exempt and audit', async () => {
    const { as } = await setup();
    await expect(as.mutation(probe.probeSkippedButAudits, {})).rejects.toThrow(
      /declared `audit: \{ skip \}` but recorded an audit row/,
    );
  });

  test('one act may record several rows, and they share its timestamp', async () => {
    const { t, as } = await setup();

    await as.mutation(probe.probeTwoRows, {});

    const rows = await auditRows(t);
    expect(rows).toHaveLength(2);
    // One act, one time. The wrapper stamps this once rather than per row, so the
    // property holds regardless of whether the runtime freezes its clock.
    expect(new Set(rows.map((row) => row.at)).size).toBe(1);
    expect(rows.map((row) => row.entityLabel).sort()).toEqual(['First', 'Second']);
  });

  test('the handler may override entity, action, outcome and metadata', async () => {
    const { t, as } = await setup();

    await as.mutation(probe.probeOverrides, {});

    const [row] = await auditRows(t);
    expect(row).toMatchObject({
      entity: 'Case',
      action: 'case.archived',
      entityLabel: 'HYP/LCMS/2026/0001',
      outcome: 'failure',
      metadata: { reason: 'probe', count: 2, forced: true },
    });
  });

  test('a handler that throws after auditing leaves no row', async () => {
    const { t, as } = await setup();

    await expect(as.mutation(probe.probeThrowsAfterAudit, {})).rejects.toThrow(
      /Deliberate failure/,
    );

    // Correct, and worth stating: the log records what happened, and a
    // rolled-back mutation did not happen. Failure entries have to come from a
    // non-transactional context - an auth hook, or an httpAction.
    expect(await auditRows(t)).toHaveLength(0);
    expect(await tagRows(t)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('identity', () => {
  test('an unauthenticated call is refused', async () => {
    const { t } = await setup();
    await expect(t.mutation(probe.probeNoPermission, {})).rejects.toThrow(/Not signed in\./);
  });

  test('an auth account with no domain user is refused, not provisioned', async () => {
    const t = convexTest({ schema });
    await seedSettings(t);
    const stranger = t.withIdentity({ subject: 'auth_someone_else' });

    await expect(stranger.mutation(probe.probeNoPermission, {})).rejects.toThrow(/Not signed in\./);

    // The register is administered, not self-service. Completing a sign-in must
    // not be enough to conjure a staff record.
    expect(await t.run(async (ctx) => await ctx.db.query('users').collect())).toHaveLength(0);
  });

  test.each(['disabled', 'locked', 'invited'] as const)(
    'a %s account is refused on the request path, not at token expiry',
    async (status) => {
      const { as } = await setup({ status });
      await expect(as.mutation(probe.probeNoPermission, {})).rejects.toThrow(
        new RegExp(`This account is ${status}\\.`),
      );
    },
  );

  test('the actor reaches the handler, so no call site passes an actorId', async () => {
    const { as } = await setup();
    await expect(as.mutation(probe.probeNoPermission, {})).resolves.toBe(
      'adaeze.okonkwo@hyprep.gov.ng',
    );
  });
});

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

describe('permissions', () => {
  test('a role without the permission is refused, and writes nothing', async () => {
    const { t, as } = await setup({ role: 'READ_ONLY' });

    await expect(as.mutation(probe.probeAudited, { label: 'Nope' })).rejects.toThrow(
      /does not permit this action \(config\.manage\)/,
    );
    expect(await tagRows(t)).toHaveLength(0);
  });

  test('a permission-less function is open to the most junior role', async () => {
    const { as } = await setup({ role: 'READ_ONLY' });
    await expect(as.mutation(probe.probeNoPermission, {})).resolves.toBeTypeOf('string');
    await expect(as.query(probe.probeOpenQuery, {})).resolves.toBe('Adaeze Okonkwo');
  });

  test('queries enforce the permission too', async () => {
    const { as } = await setup({ role: 'CASE_OFFICER' });
    await expect(as.query(probe.probeQuery, {})).rejects.toThrow(/does not permit this action/);
  });

  test('a query resolves the actor and its live permission set', async () => {
    const { as } = await setup();
    const result = await as.query(probe.probeQuery, {});
    expect(result.canManageConfig).toBe(true);
    expect(result.permissions).toBeGreaterThan(0);
    expect(result.email).toBe('adaeze.okonkwo@hyprep.gov.ng');
  });

  test('the matrix table decides, not the compiled default', async () => {
    const { t, as } = await setup();

    // What an administrator revoking `config.manage` in Admin -> Roles does. If
    // enforcement consulted DEFAULT_PERMISSION_MATRIX, the UI would show the
    // permission gone while every server call carried on allowing it.
    await t.run(async (ctx) => {
      await ctx.db.insert('permissionMatrix', {
        role: 'SUPER_ADMIN',
        permissions: ['case.view.all'],
        updatedAt: '2026-08-24T10:00:00.000Z',
        updatedById: null,
      });
    });

    await expect(as.mutation(probe.probeAudited, { label: 'Revoked' })).rejects.toThrow(
      /does not permit this action \(config\.manage\)/,
    );
  });

  test('a missing matrix row falls back to the default rather than locking everyone out', async () => {
    // No permissionMatrix rows at all - a fresh deployment before the seed. The
    // safe end of that failure is the shipped default; the alternative strands
    // the administrator who would fix it.
    const { as } = await setup();
    await expect(as.mutation(probe.probeAudited, { label: 'Fresh' })).resolves.toBeTypeOf('string');
  });
});

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

describe('security compliance', () => {
  test('an outstanding MFA enrolment blocks writes at the server', async () => {
    const { t, as } = await setup({ mfaEnabled: false }, { mfaRequiredForRoles: ['SUPER_ADMIN'] });

    await expect(as.mutation(probe.probeAudited, { label: 'Blocked' })).rejects.toThrow(
      /Two-factor authentication is required/,
    );

    // Routing the client to an enrolment screen is not enforcement: the same
    // session token can call any mutation directly.
    expect(await tagRows(t)).toHaveLength(0);
  });

  test('an individual MFA requirement blocks writes on its own', async () => {
    // Admin -> Users can demand an enrolment from one person. The role-wide rule
    // is off in the harness, so this passes only if the per-user flag is honoured
    // by itself - which is the whole reason it exists as a separate field.
    const { as } = await setup({ mfaEnabled: false, mfaRequired: true });

    await expect(as.mutation(probe.probeAudited, { label: 'Blocked' })).rejects.toThrow(
      /Two-factor authentication is required/,
    );
  });

  test('enrolling discharges an individual requirement without withdrawing it', async () => {
    // `mfaRequired` records what an administrator asked for and stays set;
    // `mfaEnabled` records what the user did about it. Only the second can clear
    // the block, and an administrator must not have to remember to undo the first.
    const { as } = await setup({ mfaEnabled: true, mfaRequired: true });

    await expect(as.mutation(probe.probeAudited, { label: 'Enrolled' })).resolves.toBeTypeOf(
      'string',
    );
  });

  test('an expired password blocks writes at the server', async () => {
    const { as } = await setup(
      { passwordChangedAt: '2026-01-01T00:00:00.000Z' },
      { passwordExpiryDays: 90 },
    );
    await expect(as.mutation(probe.probeAudited, { label: 'Blocked' })).rejects.toThrow(
      /password has expired/,
    );
  });

  test('the mutations that resolve an obligation still run during it', async () => {
    const { t, as } = await setup(
      { mfaEnabled: false, passwordChangedAt: '2026-01-01T00:00:00.000Z' },
      { mfaRequiredForRoles: ['SUPER_ADMIN'], passwordExpiryDays: 90 },
    );

    // Both obligations outstanding at once. Without `allowNonCompliant` the user
    // would be refused the very mutations that clear them, and stuck.
    await as.mutation(probe.probeCompliancePermitted, {});
    expect(await auditRows(t)).toHaveLength(1);
  });

  test('a user who has never set a password has nothing to expire', async () => {
    // An SSO account, or an invitation not yet accepted.
    const { as } = await setup({ passwordChangedAt: null }, { passwordExpiryDays: 90 });
    await expect(as.mutation(probe.probeAudited, { label: 'Sso' })).resolves.toBeTypeOf('string');
  });

  test('with no settings row, compliance cannot block the bootstrap', async () => {
    const t = convexTest({ schema });
    const userId = await seedUser(t, { mfaEnabled: false });
    await t.run((ctx) => ctx.db.insert('userSessions', { userId, authSessionId: 'bootstrap-session', device: 'Desktop', browser: 'Test', ipAddress: '', location: '', startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), revokedAt: null }));
    const as = t.withIdentity({ subject: AUTH_SUBJECT, sessionId: 'bootstrap-session' });

    // The state a deployment is in before the seed runs. Refusing writes here
    // would mean nothing could ever create the settings row.
    await expect(as.mutation(probe.probeAudited, { label: 'Bootstrap' })).resolves.toBeTypeOf(
      'string',
    );
  });
});
