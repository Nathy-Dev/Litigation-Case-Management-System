import { v } from 'convex/values';
import { permissionsForRole } from './lib/actor';
import { authedQuery } from './lib/functions';
import { query } from './_generated/server';
import {
  caseTypeCategoryValidator,
  courtTierValidator,
  documentGroupValidator,
  permissionValidator,
  roleValidator,
  ROLES,
  staffTitleValidator,
  userStatusValidator,
  type Permission,
} from './shared/enums';
import { REPORT_DEFINITIONS } from './shared/reports';
import { CASE_TEMPLATES, WORKFLOW_TEMPLATES } from './shared/templates';

/**
 * HYPREP LCMS - the reference bundle.
 *
 * The single subscription that powers every dropdown, filter and lookup in the
 * UI. It is deliberately one query rather than a dozen, because each consumer
 * reads most of the same small, stable configuration: one round trip, one
 * subscription that invalidates together when an administrator edits a lookup
 * table.
 *
 * What is *not* here is just as deliberate. The register itself, the dashboard
 * maths and the reports all grow without bound and are shaped by row-level
 * visibility, so they have their own queries in `cases.ts` / `dashboard.ts` /
 * `reports.ts`. And the caller's own identity and permissions live in
 * `auth.me`, not here, so that the auth route and this configuration route
 * cannot come to disagree about who somebody is.
 *
 * The `directory` field is the staff projection also served on its own by
 * `users.directory` - any signed-in colleague turns a user id into a name, even
 * in the assignee pickers on a matter they can already open.
 */

// ---------------------------------------------------------------------------
// Row projections
// ---------------------------------------------------------------------------

const courtRow = v.object({
  id: v.id('courts'),
  name: v.string(),
  tier: courtTierValidator,
  division: v.string(),
  state: v.string(),
  address: v.string(),
  active: v.boolean(),
});

const caseTypeRow = v.object({
  id: v.id('caseTypes'),
  name: v.string(),
  description: v.string(),
  category: caseTypeCategoryValidator,
  active: v.boolean(),
});

const documentTypeRow = v.object({
  id: v.id('documentTypes'),
  name: v.string(),
  group: documentGroupValidator,
  retentionYears: v.number(),
  requiresConfidentiality: v.boolean(),
  active: v.boolean(),
});

const tagRow = v.object({
  id: v.id('tags'),
  label: v.string(),
  color: v.string(),
  usageCount: v.number(),
});

const teamRow = v.object({
  id: v.id('teams'),
  name: v.string(),
  description: v.string(),
  leadUserId: v.union(v.id('users'), v.null()),
  memberIds: v.array(v.id('users')),
});

const directoryRow = v.object({
  id: v.id('users'),
  fullName: v.string(),
  email: v.string(),
  title: staffTitleValidator,
  role: roleValidator,
  department: v.string(),
  teamId: v.union(v.id('teams'), v.null()),
  avatarColor: v.string(),
  initials: v.string(),
  status: userStatusValidator,
});

const settingsRow = v.object({
  organisationName: v.string(),
  unitName: v.string(),
  dateFormat: v.union(v.literal('dd/MM/yyyy'), v.literal('yyyy-MM-dd'), v.literal('dd MMM yyyy')),
  timeZone: v.string(),
  currency: v.literal('NGN'),
  sessionTimeoutMinutes: v.number(),
  passwordExpiryDays: v.number(),
  passwordMinLength: v.number(),
  passwordRequireComplexity: v.boolean(),
  maxFailedLoginAttempts: v.number(),
  mfaRequiredForRoles: v.array(roleValidator),
  reminderOffsetsHours: v.array(v.number()),
  digestFrequency: v.union(v.literal('daily'), v.literal('weekly'), v.literal('off')),
  retentionArchiveAfterYears: v.number(),
  storageQuotaGb: v.number(),
  storageUsedGb: v.number(),
  backupSchedule: v.union(v.literal('hourly'), v.literal('daily'), v.literal('weekly')),
  backupRetentionDays: v.number(),
  watermarkConfidentialDownloads: v.boolean(),
  ocrEnabled: v.boolean(),
  smsEnabled: v.boolean(),
  ssoEnabled: v.boolean(),
  retentionDeletionEnabled: v.boolean(),
});

/**
 * Everything the UI needs to render forms, filters and the config screens.
 *
 * `permissions` is included for convenience (the single source of truth for the
 * caller's grants is still `auth.me`, rendered reactively at the top of the
 * tree), so a screen can read its configuration and its privileges from one
 * query rather than wiring `me` through a second layer.
 */
export const bundle = authedQuery({
  permission: null,
  args: {},
  returns: v.object({
    courts: v.array(courtRow),
    caseTypes: v.array(caseTypeRow),
    documentTypes: v.array(documentTypeRow),
    tags: v.array(tagRow),
    teams: v.array(teamRow),
    directory: v.array(directoryRow),
    settings: settingsRow,
    permissions: v.array(permissionValidator),
    reports: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        description: v.string(),
        requirement: v.string(),
        columns: v.array(
          v.object({
            key: v.string(),
            label: v.string(),
            align: v.optional(v.union(v.literal('left'), v.literal('right'), v.literal('center'))),
          }),
        ),
      }),
    ),
    workflowTemplates: v.array(v.any()),
    caseTemplates: v.array(v.any()),
  }),
  handler: async (ctx) => {
    const [courts, caseTypes, documentTypes, tags, teams, users] = await Promise.all([
      ctx.db.query('courts').collect(),
      ctx.db.query('caseTypes').collect(),
      ctx.db.query('documentTypes').collect(),
      ctx.db.query('tags').collect(),
      ctx.db.query('teams').collect(),
      ctx.db.query('users').collect(),
    ]);

    const settings = await ctx.db.query('settings').first();

    return {
      courts: courts.map((court) => ({
        id: court._id,
        name: court.name,
        tier: court.tier,
        division: court.division,
        state: court.state,
        address: court.address,
        active: court.active,
      })),
      caseTypes: caseTypes.map((item) => ({
        id: item._id,
        name: item.name,
        description: item.description,
        category: item.category,
        active: item.active,
      })),
      documentTypes: documentTypes.map((item) => ({
        id: item._id,
        name: item.name,
        group: item.group,
        retentionYears: item.retentionYears,
        requiresConfidentiality: item.requiresConfidentiality,
        active: item.active,
      })),
      tags: tags.map((tag) => ({
        id: tag._id,
        label: tag.label,
        color: tag.color,
        usageCount: tag.usageCount,
      })),
      teams: teams.map((team) => ({
        id: team._id,
        name: team.name,
        description: team.description,
        leadUserId: team.leadUserId,
        memberIds: team.memberIds,
      })),
      directory: users
        .map((user) => ({
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          title: user.title,
          role: user.role,
          department: user.department,
          teamId: user.teamId,
          avatarColor: user.avatarColor,
          initials: user.initials,
          status: user.status,
        }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
      settings: {
        organisationName: settings?.organisationName ?? '',
        unitName: settings?.unitName ?? '',
        dateFormat: settings?.dateFormat ?? 'dd/MM/yyyy',
        timeZone: settings?.timeZone ?? '',
        currency: settings?.currency ?? ('NGN' as const),
        sessionTimeoutMinutes: settings?.sessionTimeoutMinutes ?? 30,
        passwordExpiryDays: settings?.passwordExpiryDays ?? 90,
        passwordMinLength: settings?.passwordMinLength ?? 12,
        passwordRequireComplexity: settings?.passwordRequireComplexity ?? true,
        maxFailedLoginAttempts: settings?.maxFailedLoginAttempts ?? 5,
        mfaRequiredForRoles: settings?.mfaRequiredForRoles ?? [],
        reminderOffsetsHours: settings?.reminderOffsetsHours ?? [],
        digestFrequency: settings?.digestFrequency ?? ('daily' as const),
        retentionArchiveAfterYears: settings?.retentionArchiveAfterYears ?? 7,
        storageQuotaGb: settings?.storageQuotaGb ?? 500,
        storageUsedGb: settings?.storageUsedGb ?? 0,
        backupSchedule: settings?.backupSchedule ?? ('daily' as const),
        backupRetentionDays: settings?.backupRetentionDays ?? 90,
        watermarkConfidentialDownloads: settings?.watermarkConfidentialDownloads ?? true,
        ocrEnabled: settings?.ocrEnabled ?? false,
        smsEnabled: settings?.smsEnabled ?? false,
        ssoEnabled: settings?.ssoEnabled ?? false,
        retentionDeletionEnabled: settings?.retentionDeletionEnabled ?? false,
      },
      permissions: [...ctx.actor.permissions] as Permission[],
      reports: REPORT_DEFINITIONS,
      workflowTemplates: WORKFLOW_TEMPLATES,
      caseTemplates: CASE_TEMPLATES,
    };
  },
});

/**
 * Whether SSO sign-in is available right now.
 *
 * A plain `query` - deliberately *not* `authedQuery` - because the sign-in page
 * renders for callers who are not signed in yet, and it needs to know whether
 * to show the "Sign in with single sign-on" button. `bundle` cannot be used
 * there: it is an `authedQuery`, so an anonymous visitor asking for it gets a
 * "Not signed in." error that crashes the page. This gate reads only the
 * `ssoEnabled` setting, which is safe to expose to anyone.
 *
 * Mirrors `authEvents.isSsoEnabled` (the internal gate the OIDC route checks)
 * so the button and the route cannot disagree.
 */
export const ssoGate = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const settings = await ctx.db.query('settings').first();
    return settings?.ssoEnabled ?? false;
  },
});

/**
 * The whole role -> permission matrix, for the editor that maintains it.
 *
 * Separate from the bundle and gated, because only Admin -> Roles and Permissions
 * reads it. Returned as an array rather than a keyed object so that a role added
 * to `ROLES` needs no change here, and in `ROLES` order so the editor's columns
 * run Super Admin to Read-only rather than alphabetically.
 *
 * Roles with no stored row fall back to the seeded default, which is
 * `permissionsForRole`'s behaviour on every other path too - the editor must show
 * what the server would actually enforce, not an empty column.
 */
export const roleMatrix = authedQuery({
  permission: 'role.manage',
  args: {},
  returns: v.array(
    v.object({
      role: roleValidator,
      permissions: v.array(permissionValidator),
      updatedAt: v.union(v.string(), v.null()),
      updatedById: v.union(v.id('users'), v.null()),
      updatedByLabel: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query('permissionMatrix').collect();
    const labels = new Map<string, string>();

    return await Promise.all(
      ROLES.map(async (role) => {
        const row = rows.find((candidate) => candidate.role === role) ?? null;
        const permissions = [...(await permissionsForRole(ctx, role))];

        if (row === null || row.updatedById === null) {
          return {
            role,
            permissions,
            updatedAt: row?.updatedAt ?? null,
            updatedById: row?.updatedById ?? null,
            updatedByLabel: null,
          };
        }

        // One read per distinct editor rather than one per role: in practice a
        // single administrator has touched every row, and six identical reads to
        // render six identical names would be five reads wasted.
        let label = labels.get(row.updatedById);
        if (label === undefined) {
          const editor = await ctx.db.get(row.updatedById);
          label = editor?.fullName ?? 'a deleted user';
          labels.set(row.updatedById, label);
        }

        return {
          role,
          permissions,
          updatedAt: row.updatedAt,
          updatedById: row.updatedById,
          updatedByLabel: label,
        };
      }),
    );
  },
});
