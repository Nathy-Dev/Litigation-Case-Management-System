import type { UserIdentity } from 'convex/server';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Permission, Role } from '../shared/enums';
import { DEFAULT_PERMISSION_MATRIX } from '../shared/permissions';
import { makeActor, type AccessActor } from './access';

/**
 * HYPREP LCMS - who is calling, and what they may do.
 *
 * One resolution path for every function in the deployment. Queries need it to
 * apply row-level visibility, mutations need it to enforce RBAC and stamp the
 * audit trail, and the HTTP API needs it to attribute an API key to a user. If
 * any of those resolved identity differently, the audit log would stop matching
 * what actually happened.
 *
 * The prototype had no equivalent: the client passed `actorId` into every store
 * mutation, defaulting to the string `'system'` when no user was loaded. That
 * made a forged actor a one-line edit in the browser console, and it is the
 * reason `actorId` disappears from every call site rather than being ported.
 */

/** Failures here are the caller's fault, and the message is shown to them. */
export class AccessError extends Error {}

type AnyCtx = QueryCtx | MutationCtx;

/**
 * The signed-in caller as the two tables see them.
 *
 * `user` is `null` for a valid Better Auth account with no staff record - a
 * distinct state from "nobody is signed in", and one `api.auth.me` has to report
 * differently, so the two are not collapsed here.
 */
export interface Caller {
  /** Better Auth's user id: the JWT `sub` claim, and `users.authUserId`. */
  authUserId: string;
  /**
   * Better Auth's session id, from the `sessionId` claim the `convex` plugin
   * adds. `null` only if a token was minted without it, which no current code
   * path does - treated as "no session to check" rather than as a failure,
   * because refusing on it would brick every session on a token-format change.
   */
  authSessionId: string | null;
  user: Doc<'users'> | null;
}

/**
 * Resolves the caller, or `null` if nobody is signed in.
 *
 * Two tables, one identity. Better Auth owns credentials, sessions and MFA
 * factors; the domain `users` table owns role, unit, licence number and status.
 * They are joined on `authUserId`.
 *
 * **An auth account with no domain user is denied, never auto-created.** Anyone
 * who can complete a sign-in would otherwise be able to conjure themselves a
 * staff record, and the register is a government legal unit's - the roster is
 * administered, not self-service. The single exception is SSO just-in-time
 * provisioning, which creates a `READ_ONLY`/`invited` user explicitly and
 * elsewhere, so that the privilege grant is a visible act rather than a side
 * effect of a login.
 */
export async function resolveCaller(ctx: AnyCtx): Promise<Caller | null> {
  const identity: UserIdentity | null = await ctx.auth.getUserIdentity();
  if (identity === null) return null;

  const sessionId = identity.sessionId;

  return {
    authUserId: identity.subject,
    authSessionId: typeof sessionId === 'string' ? sessionId : null,
    user: await ctx.db
      .query('users')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', identity.subject))
      .unique(),
  };
}

/**
 * The live permission set for a role.
 *
 * Read from the `permissionMatrix` table, not from `DEFAULT_PERMISSION_MATRIX` -
 * the matrix is editable at runtime through Admin -> Roles and Permissions (TOR
 * section 19), and an enforcement path that consulted the compiled-in default
 * would let an administrator revoke a permission in the UI while every server
 * call carried on allowing it.
 *
 * The default is the fallback for one situation only: a role whose matrix row is
 * missing, which means the seed has not run or the row was deleted. Falling back
 * to the shipped default is the safe end of that failure - the alternative is
 * every user in that role losing all access at once, which on a fresh deployment
 * would lock out the very administrator who needs to fix it.
 */
export async function permissionsForRole(
  ctx: AnyCtx,
  role: Role,
): Promise<readonly Permission[]> {
  const row = await ctx.db
    .query('permissionMatrix')
    .withIndex('by_role', (q) => q.eq('role', role))
    .unique();

  return row?.permissions ?? DEFAULT_PERMISSION_MATRIX[role];
}

/** The settings singleton. One row, created by the seed. */
export async function loadSettings(ctx: AnyCtx): Promise<Doc<'settings'> | null> {
  return await ctx.db.query('settings').first();
}

// ---------------------------------------------------------------------------
// Session liveness
// ---------------------------------------------------------------------------

/**
 * Why a token that verifies is nonetheless not good enough any more.
 *
 * Both reasons are things Convex's own token check cannot see. A Convex JWT is
 * self-contained and valid for its full lifetime (15 minutes by default), so
 * between the moment a session is revoked and the moment that token expires,
 * `ctx.auth.getUserIdentity()` keeps returning a perfectly good identity. For
 * "disable this user and cut them off now" to mean what it says, the request path
 * has to consult session state rather than only the token.
 */
export type SessionVerdict = { live: true } | { live: false; reason: string };

/**
 * Whether the caller's session is still usable.
 *
 * Read from `userSessions` - the app-side projection written by
 * `convex/authEvents.ts` - rather than from Better Auth's own session table. Two
 * reasons. It is an ordinary indexed read in the same transaction, so a query can
 * do it and it costs one lookup; and going through the component's adapter would
 * make `lib/actor.ts` import `auth.ts`, which imports this file.
 *
 * **A missing projection allows the request.** The projection is only skipped
 * when the domain user does not exist, and such a caller is already refused a
 * step earlier - so in practice this branch is a fresh deployment or a test
 * harness holding an identity with no session row, and failing closed there would
 * refuse every request on a deployment nobody had yet signed into.
 */
export async function sessionVerdict(
  ctx: AnyCtx,
  caller: Caller,
  settings?: Doc<'settings'> | null,
): Promise<SessionVerdict> {
  if (caller.authSessionId === null) return { live: true };

  const projection = await ctx.db
    .query('userSessions')
    .withIndex('by_authSessionId', (q) => q.eq('authSessionId', caller.authSessionId as string))
    .unique();
  if (projection === null) return { live: true };

  if (projection.revokedAt !== null) {
    return { live: false, reason: 'This session has been signed out. Sign in again.' };
  }

  // The configurable idle timeout (TOR section 19). Better Auth's own
  // `session.expiresIn` is an *absolute* cap fixed at construction time and
  // cannot express this, because Better Auth refreshes a session whenever the
  // client renews its Convex token - which happens on a timer whether or not
  // anybody is at the keyboard. So idleness is measured from `lastSeenAt`, which
  // only `api.auth.touch` advances, and only in response to real interaction.
  //
  // The consequence is that the client *must* call `touch` while in use or an
  // active session dies mid-sentence. That is deliberate: it is the same property
  // that makes this a real control rather than a client-side courtesy, since a
  // stolen token that does not replay the touch expires on schedule.
  const config = settings === undefined ? await loadSettings(ctx) : settings;
  const idleMinutes = config?.sessionTimeoutMinutes ?? 0;
  if (idleMinutes > 0) {
    const lastSeen = Date.parse(projection.lastSeenAt);
    if (!Number.isNaN(lastSeen) && Date.now() - lastSeen > idleMinutes * 60_000) {
      return {
        live: false,
        reason: `Signed out after ${idleMinutes} minutes of inactivity. Sign in again.`,
      };
    }
  }

  return { live: true };
}

/**
 * Everything a function needs to know about its caller.
 *
 * `access` is the reduced form `convex/lib/access.ts` consumes, carried alongside
 * the full document so a handler does not have to rebuild the permission set to
 * ask an access question.
 */
export interface Actor {
  user: Doc<'users'>;
  permissions: readonly Permission[];
  access: AccessActor;
  can: (permission: Permission) => boolean;
  /**
   * The session this request arrived on, so a handler can tell it apart from the
   * caller's other sessions - `api.auth.touch` advances only this one, and
   * revoking sessions has to be able to spare it.
   */
  authSessionId: string | null;
}

export async function buildActor(
  ctx: AnyCtx,
  user: Doc<'users'>,
  authSessionId: string | null,
): Promise<Actor> {
  const permissions = await permissionsForRole(ctx, user.role);
  const access = makeActor(user._id, permissions);
  return {
    user,
    permissions,
    access,
    can: (permission) => access.permissions.has(permission),
    authSessionId,
  };
}

/**
 * Resolves the caller, or throws.
 *
 * `status` is checked here rather than left to Better Auth, because the two
 * answer different questions: Better Auth knows whether the session token is
 * valid, and this knows whether the person is still employed. A disabled account
 * whose session has not yet expired must stop working immediately, so the check
 * has to sit on the request path and not only at sign-in.
 *
 * `invited` is rejected alongside `disabled` and `locked`: an invitation that has
 * not been accepted is not yet a staff member, and SSO JIT provisioning creates
 * users in exactly that state.
 *
 * Session liveness is the third check, for the same reason as the second: a valid
 * token is not evidence that the session behind it still exists. See
 * `sessionVerdict`.
 */
export async function requireActor(ctx: AnyCtx): Promise<Actor> {
  const caller = await resolveCaller(ctx);
  if (caller === null || caller.user === null) throw new AccessError('Not signed in.');

  const { user } = caller;
  if (user.status !== 'active') {
    // Deliberately specific: the user can act on "locked" (contact an
    // administrator) and this is their own account, so there is nothing to leak.
    throw new AccessError(`This account is ${user.status}.`);
  }

  const verdict = await sessionVerdict(ctx, caller);
  if (!verdict.live) throw new AccessError(verdict.reason);

  return await buildActor(ctx, user, caller.authSessionId);
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!actor.can(permission)) {
    throw new AccessError(`Your role does not permit this action (${permission}).`);
  }
}

/**
 * Whether the caller is behind on a security obligation the TOR imposes.
 *
 * Returned rather than thrown so `api.auth.me` can report it to the client - the
 * client needs it to route to the enrolment or password-change screen, and the
 * mutation wrapper needs it to refuse everything else in the meantime.
 *
 * Client-side routing alone is not enforcement. A user who is required to enrol
 * in MFA but has not can still call any mutation directly with their session
 * token, so the same condition has to block writes at the server.
 */
export interface ComplianceState {
  mustEnrolMfa: boolean;
  mustChangePassword: boolean;
}

export async function complianceFor(
  ctx: AnyCtx,
  user: Doc<'users'>,
  settings?: Doc<'settings'> | null,
): Promise<ComplianceState> {
  const config = settings === undefined ? await loadSettings(ctx) : settings;
  if (config === null) return { mustEnrolMfa: false, mustChangePassword: false };

  // Two ways to owe an enrolment: the role-wide rule in Admin -> Settings, and an
  // individual requirement set in Admin -> Users. Either is sufficient; only
  // actually enrolling discharges it.
  const mustEnrolMfa =
    (config.mfaRequiredForRoles.includes(user.role) || (user.mfaRequired ?? false)) &&
    !user.mfaEnabled;

  // Expiry is measured from the last change. A user who has never set a password
  // - an SSO account, or an invitation not yet accepted - has nothing to expire.
  let mustChangePassword = false;
  if (config.passwordExpiryDays > 0 && user.passwordChangedAt !== null) {
    const changedAt = Date.parse(user.passwordChangedAt);
    if (!Number.isNaN(changedAt)) {
      const ageDays = (Date.now() - changedAt) / 86_400_000;
      mustChangePassword = ageDays >= config.passwordExpiryDays;
    }
  }

  return { mustEnrolMfa, mustChangePassword };
}

/**
 * Refuses a caller who owes a security obligation.
 *
 * The same refusal is needed by two wrappers - `authedMutation` before it runs a
 * handler, and the gate query behind `authedAction` - and the wording is part of
 * the enforcement: it is what tells a user which screen will clear the block. One
 * function so the two cannot come to disagree about either the rule or the words.
 */
export async function requireCompliance(
  ctx: AnyCtx,
  user: Doc<'users'>,
  settings?: Doc<'settings'> | null,
): Promise<void> {
  const compliance = await complianceFor(ctx, user, settings);
  if (compliance.mustEnrolMfa) {
    throw new AccessError(
      'Two-factor authentication is required for your role. Enrol before making changes.',
    );
  }
  if (compliance.mustChangePassword) {
    throw new AccessError('Your password has expired. Change it before making changes.');
  }
}
