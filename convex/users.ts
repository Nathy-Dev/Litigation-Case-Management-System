import { v, type Infer } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { permissionsForRole } from './lib/actor';
import { authedMutation, authedQuery } from './lib/functions';
import { initialsFrom } from './shared/pure';
import { roleValidator, staffTitleValidator, userStatusValidator, type Role } from './shared/enums';

/**
 * HYPREP LCMS - the staff register.
 *
 * Two files serve Admin -> Users, split along a line worth stating: this one holds
 * everything that is only a database write, and `userAccounts.ts` holds everything
 * that has to talk to Better Auth. The split is not tidiness. Queries here are on
 * the hot path - the roster, the session list, and the profile page all subscribe -
 * and importing `createAuth` would drag Better Auth's bundle into the isolate that
 * serves them. Nothing in this file imports `./auth`.
 *
 * The division of responsibility between the two tables is set out in `auth.ts`:
 * Better Auth owns credentials, sessions and second factors; the `users` table owns
 * who somebody is in the organisation and what they are allowed to do. So `email`
 * and `status` are deliberately **not** editable here. Email belongs to the auth
 * record and changing it in one place only would silently break sign-in; status
 * transitions have consequences (revoking live sessions, clearing a lock counter)
 * that a `db.patch` cannot carry out. Both live in `userAccounts.ts`.
 *
 * What is left is genuinely local: names, titles, teams, roles and the individual
 * MFA demand.
 */

// ---------------------------------------------------------------------------
// Shapes returned to the client
// ---------------------------------------------------------------------------

/**
 * A roster row.
 *
 * Deliberately the shape of `src/types/index.ts`'s `User` plus the two fields the
 * prototype had nowhere to put - `mfaRequired`, which its "Require MFA" menu item
 * was conflating with enrolment, and `lockedAt`, which tells an administrator
 * whether a locked account locked itself out ten minutes or ten weeks ago.
 *
 * `_id` is mapped to `id` on the way out so the client keeps treating these as
 * opaque strings and every existing `=== user.id` comparison survives untouched.
 */
const userRow = v.object({
  id: v.id('users'),
  fullName: v.string(),
  email: v.string(),
  phone: v.string(),
  title: staffTitleValidator,
  role: roleValidator,
  department: v.string(),
  teamId: v.union(v.id('teams'), v.null()),
  practisingLicenceNo: v.union(v.string(), v.null()),
  firm: v.union(v.string(), v.null()),
  avatarColor: v.string(),
  initials: v.string(),
  status: userStatusValidator,
  mfaEnabled: v.boolean(),
  mfaRequired: v.boolean(),
  failedLoginAttempts: v.number(),
  lastLoginAt: v.union(v.string(), v.null()),
  createdAt: v.string(),
  lockedAt: v.union(v.string(), v.null()),
});

function toRow(user: Doc<'users'>) {
  return {
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    title: user.title,
    role: user.role,
    department: user.department,
    teamId: user.teamId,
    practisingLicenceNo: user.practisingLicenceNo,
    firm: user.firm,
    avatarColor: user.avatarColor,
    initials: user.initials,
    status: user.status,
    mfaEnabled: user.mfaEnabled,
    // Optional while the backfill migration ran; missing -> false.
    mfaRequired: user.mfaRequired ?? false,
    failedLoginAttempts: user.failedLoginAttempts,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    lockedAt: user.lockedAt,
  };
}

/**
 * A live session, as both the profile page and Admin -> System render it.
 *
 * `userLabel` is included because the admin view lists every session in the
 * deployment and a table of device names with no names attached is useless; the
 * profile page ignores it. One shape for both saves a second query and a second
 * projection that would have to agree with this one.
 */
const sessionRow = v.object({
  id: v.id('userSessions'),
  userId: v.id('users'),
  userLabel: v.string(),
  device: v.string(),
  browser: v.string(),
  ipAddress: v.string(),
  location: v.string(),
  startedAt: v.string(),
  lastSeenAt: v.string(),
  /** Whether this is the session making the request - which must not be revoked by accident. */
  current: v.boolean(),
});

// ---------------------------------------------------------------------------
// Invariant: the register must never be left without an administrator
// ---------------------------------------------------------------------------

/**
 * Refuses a change that would leave nobody able to administer the system.
 *
 * The reachable accident is mundane: two administrators, one demotes the other to
 * `LEGAL_STAFF` and then demotes themselves, and now the deployment has no route
 * to Admin -> Users at all. Recovering from that means the bootstrap endpoint,
 * which is permanently closed once the register is non-empty - so it means editing
 * the database by hand. Cheaper to refuse.
 *
 * `user.manage` is the permission tested rather than a role name, because the
 * matrix is editable at runtime: an operator who grants `user.manage` to a sixth
 * role should find that role counts, and one who revokes it from `ADMIN` should
 * find it does not. Roles are resolved through a memo, so this costs at most as
 * many matrix reads as there are distinct roles among active users.
 */
async function assertRegisterKeepsAnAdministrator(
  ctx: MutationCtx,
  prospective: { userId: Id<'users'>; role: Role; status: Doc<'users'>['status'] },
): Promise<void> {
  const active = await ctx.db
    .query('users')
    .withIndex('by_status', (q) => q.eq('status', 'active'))
    .collect();

  const cache = new Map<Role, boolean>();
  const manages = async (role: Role): Promise<boolean> => {
    const seen = cache.get(role);
    if (seen !== undefined) return seen;
    const permissions = await permissionsForRole(ctx, role);
    const holds = permissions.includes('user.manage');
    cache.set(role, holds);
    return holds;
  };

  for (const candidate of active) {
    // The subject is counted from the prospective state, not the stored one, so
    // this answers "after the change" rather than "before it".
    const isSubject = candidate._id === prospective.userId;
    const role = isSubject ? prospective.role : candidate.role;
    const status = isSubject ? prospective.status : candidate.status;
    if (status !== 'active') continue;
    if (await manages(role)) return;
  }

  throw new Error(
    'This would leave the system with no active administrator. Give someone else the Admin role first.',
  );
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The staff register.
 *
 * Unpaginated on purpose. The register is one row per member of a legal unit -
 * tens, not thousands - and `AdminUsersPage` filters, sorts and groups the whole
 * list client-side. Paginating it would mean rebuilding all of that server-side
 * for no benefit. If an installation ever outgrows this, the sort key is `fullName`
 * and the index to add is on it.
 */
export const list = authedQuery({
  permission: 'user.view',
  args: {},
  returns: v.array(userRow),
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect();
    return users.map(toRow).sort((a, b) => a.fullName.localeCompare(b.fullName));
  },
});

/**
 * Users in a form that is safe for any signed-in caller to hold.
 *
 * Assignee pickers, owner columns and comment mentions all need to turn a user id
 * into a name, and `user.view` is held only by administrators - so without this,
 * every case row a lawyer sees would render its owner as a bare id. Nothing here is
 * more sensitive than what appears on a case file the caller can already open.
 *
 * Read by `reference.bundle`; exposed separately so the projection has one home.
 */
export const directoryRow = v.object({
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

/**
 * The projection itself, as a plain function.
 *
 * `reference.bundle` needs the same rows, and a query cannot call another query -
 * so the shape lives here as a helper and both entry points return it. Exposing it
 * this way rather than duplicating the field list is the point: a field added to the
 * directory must reach every consumer, or the register and the pickers disagree
 * about what a user is called.
 */
export async function directoryRows(ctx: QueryCtx): Promise<Infer<typeof directoryRow>[]> {
  const users = await ctx.db.query('users').collect();
  return users
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
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export const directory = authedQuery({
  permission: null,
  args: {},
  returns: v.array(directoryRow),
  handler: async (ctx) => await directoryRows(ctx),
});

/** Attaches names to session projections, one read per distinct user. */
async function withLabels(
  ctx: QueryCtx,
  sessions: Doc<'userSessions'>[],
  currentAuthSessionId: string | null,
) {
  const labels = new Map<Id<'users'>, string>();
  for (const session of sessions) {
    if (labels.has(session.userId)) continue;
    const owner = await ctx.db.get(session.userId);
    labels.set(session.userId, owner?.fullName ?? 'Deleted user');
  }

  return sessions
    .map((session) => ({
      id: session._id,
      userId: session.userId,
      userLabel: labels.get(session.userId) ?? 'Deleted user',
      device: session.device,
      browser: session.browser,
      ipAddress: session.ipAddress,
      location: session.location,
      startedAt: session.startedAt,
      lastSeenAt: session.lastSeenAt,
      current:
        currentAuthSessionId !== null && session.authSessionId === currentAuthSessionId,
    }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/**
 * Every live session in the deployment, for Admin -> System.
 *
 * Filtered on `revokedAt === null` rather than by deleting the projection, because
 * a revoked session is evidence: the audit trail records that somebody's access was
 * ended, and the row is what that entry points at. Housekeeping of ancient revoked
 * rows belongs to a retention sweep, not to this read.
 */
export const sessions = authedQuery({
  permission: 'user.view',
  args: {},
  returns: v.array(sessionRow),
  handler: async (ctx) => {
    const all = await ctx.db.query('userSessions').collect();
    return withLabels(
      ctx,
      all.filter((session) => session.revokedAt === null),
      ctx.actor.authSessionId,
    );
  },
});

/**
 * The caller's own live sessions, for the profile page.
 *
 * No permission, because seeing where your own account is signed in is not an
 * administrative act - it is the control that lets somebody notice a session they
 * do not recognise and end it themselves.
 */
export const mySessions = authedQuery({
  permission: null,
  args: {},
  returns: v.array(sessionRow),
  handler: async (ctx) => {
    const mine = await ctx.db
      .query('userSessions')
      .withIndex('by_user', (q) => q.eq('userId', ctx.actor.user._id))
      .collect();

    return withLabels(
      ctx,
      mine.filter((session) => session.revokedAt === null),
      ctx.actor.authSessionId,
    );
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Trims, collapses runs of whitespace, and insists on something usable. */
function requireName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 3) throw new Error('Enter the full name (at least 3 characters).');
  return name;
}

/**
 * Keeps `teams.memberIds` in step with a move between teams.
 *
 * The field is denormalised - `users.by_team` is the authority and every read uses
 * it - but a denormalised field that is allowed to go stale is worse than one that
 * does not exist, because the next person to read it will believe it. Same
 * reasoning as `caseMembers`: one transaction writes both sides.
 */
async function moveBetweenTeams(
  ctx: MutationCtx,
  userId: Id<'users'>,
  from: Id<'teams'> | null,
  to: Id<'teams'> | null,
): Promise<void> {
  if (from === to) return;

  if (from !== null) {
    const previous = await ctx.db.get(from);
    if (previous !== null) {
      await ctx.db.patch(from, {
        memberIds: previous.memberIds.filter((id) => id !== userId),
      });
    }
  }
  if (to !== null) {
    const next = await ctx.db.get(to);
    if (next !== null && !next.memberIds.includes(userId)) {
      await ctx.db.patch(to, { memberIds: [...next.memberIds, userId] });
    }
  }
}

/**
 * Amends who somebody is and what they may do.
 *
 * Everything here is a plain field except `role`, which is an authorization
 * decision and carries two refusals with it.
 *
 * **You cannot change your own role.** Not because it is dangerous in itself, but
 * because the only reasons to do it are to grant yourself something you were not
 * given or to lock yourself out, and an administrator who genuinely needs a
 * different role has a colleague who can grant it. This matches the existing "You
 * cannot disable yourself" rule in the row menu rather than inventing a new
 * principle.
 *
 * **You cannot strand the register.** See `assertRegisterKeepsAnAdministrator`.
 */
export const updateProfile = authedMutation({
  permission: 'user.manage',
  audit: { entity: 'User', action: 'Amended user details' },
  args: {
    userId: v.id('users'),
    fullName: v.string(),
    phone: v.string(),
    title: staffTitleValidator,
    role: roleValidator,
    department: v.string(),
    teamId: v.union(v.id('teams'), v.null()),
    practisingLicenceNo: v.union(v.string(), v.null()),
    firm: v.union(v.string(), v.null()),
    avatarColor: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const subject = await ctx.db.get(args.userId);
    if (subject === null) throw new Error('That user no longer exists.');

    const fullName = requireName(args.fullName);
    const roleChanged = args.role !== subject.role;

    if (roleChanged && subject._id === ctx.actor.user._id) {
      throw new Error('You cannot change your own role. Ask another administrator.');
    }
    if (roleChanged) {
      await assertRegisterKeepsAnAdministrator(ctx, {
        userId: subject._id,
        role: args.role,
        status: subject.status,
      });
    }

    await ctx.db.patch(subject._id, {
      fullName,
      // Recomputed rather than accepted, so the avatar can never disagree with the
      // name it is standing in for.
      initials: initialsFrom(fullName),
      phone: args.phone.trim(),
      title: args.title,
      role: args.role,
      department: args.department.trim(),
      teamId: args.teamId,
      practisingLicenceNo: args.practisingLicenceNo?.trim() || null,
      firm: args.firm?.trim() || null,
      avatarColor: args.avatarColor,
    });

    await moveBetweenTeams(ctx, subject._id, subject.teamId, args.teamId);

    await ctx.audit({
      entityId: subject._id,
      entityLabel: fullName,
      // Recorded because a role change is the one field here that alters what the
      // account can reach, and an auditor scanning for privilege escalation should
      // not have to diff two rows to find it.
      metadata: roleChanged ? { from: subject.role, to: args.role } : {},
    });

    return null;
  },
});

/**
 * Demands a second factor from one individual.
 *
 * Writes `mfaRequired`, never `mfaEnabled`: the first is what an administrator can
 * ask for, the second is what the user did about it, and the schema comment on both
 * fields explains why conflating them made the prototype's toggle a lie. Clearing
 * the demand does not un-enrol anybody - that is `userAccounts.clearMfaEnrolment`,
 * and it needs Better Auth.
 */
export const setMfaRequired = authedMutation({
  permission: 'user.manage',
  audit: { entity: 'User', action: 'Changed two-factor requirement' },
  args: { userId: v.id('users'), required: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { userId, required }) => {
    const subject = await ctx.db.get(userId);
    if (subject === null) throw new Error('That user no longer exists.');

    await ctx.db.patch(userId, { mfaRequired: required });
    await ctx.audit({
      entityId: userId,
      entityLabel: subject.fullName,
      metadata: { required, alreadyEnrolled: subject.mfaEnabled },
    });

    return null;
  },
});

/**
 * Lifts a lockout.
 *
 * Clears the counter as well as the status, because leaving it at the threshold
 * would mean the next single mistyped password locked the account again - which
 * looks to the user like the unlock never happened.
 *
 * Only reachable for `locked`. A disabled account is a decision, not an accident,
 * and re-enabling it is `userAccounts.setStatus` where the session handling lives.
 */
export const unlock = authedMutation({
  permission: 'user.manage',
  audit: { entity: 'User', action: 'Unlocked a locked account' },
  args: { userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const subject = await ctx.db.get(userId);
    if (subject === null) throw new Error('That user no longer exists.');
    if (subject.status !== 'locked') {
      throw new Error(`That account is ${subject.status}, not locked.`);
    }

    await ctx.db.patch(userId, { status: 'active', failedLoginAttempts: 0, lockedAt: null });
    await ctx.audit({
      entityId: userId,
      entityLabel: subject.fullName,
      metadata: { lockedAt: subject.lockedAt ?? 'unknown' },
    });

    return null;
  },
});

/**
 * The one thing a user may change about their own record.
 *
 * Name, title, role, team and department are all organisational facts that
 * somebody else asserts; a phone number is the user's own and is what hearing
 * reminders are sent to, so making them wait for an administrator to correct a
 * typo would cost them a court date.
 *
 * Not audited as a distinct entity change. This is deliberate rather than an
 * omission: a self-service contact correction on one's own record is not an
 * administrative act, and a trail full of them makes the entries that matter
 * harder to find. The `skip` reason records that judgement in the code.
 */
export const updateOwnContact = authedMutation({
  permission: null,
  audit: { skip: 'Self-service correction of the caller’s own phone number.' },
  args: { phone: v.string() },
  returns: v.null(),
  handler: async (ctx, { phone }) => {
    await ctx.db.patch(ctx.actor.user._id, { phone: phone.trim() });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Internal - what the actions in `userAccounts.ts` call
// ---------------------------------------------------------------------------

/**
 * The subject of an account operation, loaded from inside an action.
 *
 * Returns the whole document rather than a projection because the callers need
 * different parts of it and an action cannot reach `ctx.db` to fetch the rest.
 */
export const load = internalQuery({
  args: { userId: v.id('users') },
  returns: v.any(),
  handler: async (ctx, { userId }) => await ctx.db.get(userId),
});

/** Whether an address is already taken, so an invitation can refuse early. */
export const findByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.object({ id: v.id('users'), fullName: v.string(), status: userStatusValidator }), v.null()),
  handler: async (ctx, { email }) => {
    const existing = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first();

    return existing === null
      ? null
      : { id: existing._id, fullName: existing.fullName, status: existing.status };
  },
});

/**
 * Writes the staff record for an auth account an action has just created.
 *
 * Re-checks the address inside the transaction. The action checked it too, but an
 * action is not a transaction and two administrators inviting the same person at
 * the same moment would otherwise both pass - leaving two staff records for one
 * mailbox, which no later screen would help them untangle.
 */
export const insertProvisioned = internalMutation({
  args: {
    authUserId: v.string(),
    fullName: v.string(),
    email: v.string(),
    phone: v.string(),
    title: staffTitleValidator,
    role: roleValidator,
    department: v.string(),
    teamId: v.union(v.id('teams'), v.null()),
    practisingLicenceNo: v.union(v.string(), v.null()),
    firm: v.union(v.string(), v.null()),
    avatarColor: v.string(),
    mfaRequired: v.boolean(),
    /** Who invited them, for the audit row this writes on their behalf. */
    actorId: v.id('users'),
    actorLabel: v.string(),
  },
  returns: v.id('users'),
  handler: async (ctx, args): Promise<Id<'users'>> => {
    const clash = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', args.email))
      .first();
    if (clash !== null) {
      throw new Error(`${args.email} already has an account on this system.`);
    }

    const now = new Date(Date.now()).toISOString();
    const userId = await ctx.db.insert('users', {
      authUserId: args.authUserId,
      fullName: args.fullName,
      email: args.email,
      phone: args.phone,
      title: args.title,
      role: args.role,
      department: args.department,
      teamId: args.teamId,
      practisingLicenceNo: args.practisingLicenceNo,
      firm: args.firm,
      avatarColor: args.avatarColor,
      initials: initialsFrom(args.fullName),
      // Not `active` until they have set a password. The distinction matters to
      // `requireActor`, which refuses any non-active account, so an invitation
      // that is never accepted is not a usable credential.
      status: 'invited',
      mfaEnabled: false,
      mfaRequired: args.mfaRequired,
      failedLoginAttempts: 0,
      lastLoginAt: null,
      createdAt: now,
      // No password yet, so no expiry clock. The reset that activates the account
      // is what stamps this.
      passwordChangedAt: null,
      lockedAt: null,
    });

    await moveBetweenTeams(ctx, userId, null, args.teamId);

    await ctx.db.insert('auditLog', {
      at: now,
      actorId: args.actorId,
      actorLabel: args.actorLabel,
      action: 'Invited a new user',
      entity: 'User',
      entityId: userId,
      entityLabel: `${args.fullName} — ${args.role}`,
      ipAddress: null,
      userAgent: null,
      outcome: 'success',
      metadata: { email: args.email, role: args.role },
    });

    return userId;
  },
});

/**
 * Applies a status transition decided in an action.
 *
 * The stranding guard runs here rather than in the action for the same reason the
 * emptiness check runs inside `claimFirstSuperAdmin`: it is only sound if the read
 * and the write are in one transaction. An administrator disabling the last
 * remaining administrator is exactly the race worth closing.
 */
export const applyStatus = internalMutation({
  args: {
    userId: v.id('users'),
    status: userStatusValidator,
    actorId: v.id('users'),
    actorLabel: v.string(),
    action: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const subject = await ctx.db.get(args.userId);
    if (subject === null) throw new Error('That user no longer exists.');

    if (args.status !== 'active') {
      await assertRegisterKeepsAnAdministrator(ctx, {
        userId: subject._id,
        role: subject.role,
        status: args.status,
      });
    }

    const now = new Date(Date.now()).toISOString();
    await ctx.db.patch(args.userId, {
      status: args.status,
      // Re-enabling clears the lock counter for the same reason `unlock` does:
      // otherwise the account comes back one keystroke from locking again.
      ...(args.status === 'active' ? { failedLoginAttempts: 0, lockedAt: null } : {}),
    });

    await ctx.db.insert('auditLog', {
      at: now,
      actorId: args.actorId,
      actorLabel: args.actorLabel,
      action: args.action,
      entity: 'User',
      entityId: args.userId,
      entityLabel: subject.fullName,
      ipAddress: null,
      userAgent: null,
      outcome: 'success',
      metadata: { from: subject.status, to: args.status },
    });

    return null;
  },
});

/**
 * Records an address change that Better Auth has already carried out.
 *
 * Only the audit row. The `users.email` field is mirrored automatically, because
 * `internalAdapter.updateUser` writes through `updateWithHooks` and so fires the
 * `user.update.after` hook that `authEvents.syncFromAuthUser` is registered on -
 * patching it a second time here would be duplicated logic waiting to disagree.
 *
 * What the hook cannot do is say who ordered the change, which is the part an
 * auditor needs. `from` is therefore passed in, read by the action before it
 * touched Better Auth; by the time this runs, the old value is gone.
 */
export const recordEmailChange = internalMutation({
  args: {
    userId: v.id('users'),
    from: v.string(),
    to: v.string(),
    actorId: v.id('users'),
    actorLabel: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const subject = await ctx.db.get(args.userId);
    await ctx.db.insert('auditLog', {
      at: new Date(Date.now()).toISOString(),
      actorId: args.actorId,
      actorLabel: args.actorLabel,
      action: 'Changed a user’s email address',
      entity: 'User',
      entityId: args.userId,
      entityLabel: subject?.fullName ?? args.to,
      ipAddress: null,
      userAgent: null,
      outcome: 'success',
      metadata: { from: args.from, to: args.to },
    });

    return null;
  },
});

/**
 * Marks a session projection revoked when the hook could not.
 *
 * Normally redundant, and that is the point: deleting a Better Auth session fires
 * `session.delete.after`, which `authEvents.recordSessionEnded` uses to stamp
 * `revokedAt`. This is the fallback for the one case the hook cannot cover - a
 * projection whose auth session has already expired and been swept, so there is
 * nothing left to delete and no hook to fire. Without it, such a row would sit in
 * Admin -> System advertising a session that ended weeks ago.
 */
export const markSessionRevoked = internalMutation({
  args: { sessionId: v.id('userSessions') },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (session === null || session.revokedAt !== null) return null;
    await ctx.db.patch(sessionId, { revokedAt: new Date(Date.now()).toISOString() });
    return null;
  },
});

/**
 * One user's live sessions, so an action can resolve a projection to an auth token.
 *
 * Rows with no `authSessionId` are omitted rather than returned as nulls: the only
 * thing a caller does with this list is match it against Better Auth's own
 * sessions, and a row that never had an auth id cannot be matched.
 */
export const liveSessionsFor = internalQuery({
  args: { userId: v.id('users') },
  returns: v.array(v.object({ id: v.id('userSessions'), authSessionId: v.string() })),
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query('userSessions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    return rows.flatMap((row) =>
      row.revokedAt === null && row.authSessionId !== null
        ? [{ id: row._id, authSessionId: row.authSessionId }]
        : [],
    );
  },
});

/** One session projection by id, for the revoke path's ownership check. */
export const sessionById = internalQuery({
  args: { sessionId: v.id('userSessions') },
  returns: v.union(
    v.object({
      id: v.id('userSessions'),
      userId: v.id('users'),
      authSessionId: v.union(v.string(), v.null()),
      revokedAt: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    return session === null
      ? null
      : {
          id: session._id,
          userId: session.userId,
          authSessionId: session.authSessionId,
          revokedAt: session.revokedAt,
        };
  },
});
