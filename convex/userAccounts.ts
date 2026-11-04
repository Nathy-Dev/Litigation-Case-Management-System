import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalAction, type ActionCtx } from './_generated/server';
import { RESET_TOKEN_MINUTES, createAuth, siteUrl } from './auth';
import { invitationEmail, passwordResetEmail } from './integrations/email/templates';
import { authedAction } from './lib/functions';
import { ROLE_LABELS, roleValidator, staffTitleValidator } from './shared/enums';

/**
 * HYPREP LCMS - account operations.
 *
 * The half of Admin -> Users that cannot be a mutation. Everything here needs to
 * talk to Better Auth, which owns credentials, sessions and second factors, and
 * talking to it means HTTP and hashing - so these are actions, not transactions.
 * `users.ts` holds the half that is only a database write, and the note at its head
 * explains why the two are kept apart.
 *
 * **An action is not atomic, and this file is where that matters most.** Creating a
 * user is two writes to two stores; if the second fails, the first has happened.
 * Each function below therefore orders its steps so that a failure part-way leaves
 * a state somebody can act on, and compensates where it cannot:
 *
 * - **Invite** creates the auth record first and the staff record second, and
 *   deletes the auth record if the staff record is refused. An auth account with no
 *   staff record is a credential that `requireActor` denies - harmless, but it would
 *   also block the retry by holding the email address, so it is cleaned up.
 * - **Disable** writes the status first and revokes sessions second. If revocation
 *   fails, the account is already `disabled` and `requireActor` refuses every
 *   request from it, so the block holds even though the token is technically alive.
 *   The other order would leave a signed-out but fully enabled account.
 * - **Change email** writes Better Auth first, because that is the record sign-in
 *   reads. The domain field is mirrored by a database hook rather than by hand.
 *
 * **Audit rows follow one rule.** Where an internal mutation records the change
 * transactionally, the action declares `audit: { skip }` and names the mutation that
 * does it - a second row from out here would be a duplicate that could disagree.
 * Where there is no transaction to attach to - an email sent, a session revoked -
 * the action records it itself.
 */

/** How long an invitation is good for. Long enough to survive a weekend. */
const INVITE_TOKEN_HOURS = 48;

/** Bulk import is a convenience, not a bulk-provisioning API. */
const MAX_IMPORT_ROWS = 100;

/**
 * A single-use token for the set-password flow.
 *
 * 32 bytes from the platform CSPRNG, base64url so it survives being a path
 * segment. Deliberately not Better Auth's internal id generator: this value is
 * the only thing standing between an intercepted email and somebody else's
 * account, and it should not be able to change strength because a library
 * changed its mind about id formats.
 */
function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type AuthContext = Awaited<ReturnType<typeof createAuth>['$context']>;

/**
 * Mints a link that lets somebody choose a password.
 *
 * Reuses Better Auth's own reset machinery rather than building a parallel one:
 * the `reset-password:` identifier prefix, the `/reset-password/:token` callback
 * and the `POST /reset-password` endpoint are all its, and they already do the
 * work - validate the token once, consume it, hash the new password, and end the
 * user's other sessions. Notably `POST /reset-password` *creates* the credential
 * account when none exists, which is exactly what an invited user needs and the
 * reason an invitation does not have to set a throwaway password first.
 *
 * What is not reused is the request that normally starts it. Going through
 * `/request-password-reset` would send Better Auth's reset wording for what is
 * sometimes an invitation, and would attribute the act to the recipient rather
 * than to the administrator who ordered it. So the token is written here and the
 * wording is chosen by the caller.
 */
async function mintSetPasswordLink(
  authCtx: AuthContext,
  authUserId: string,
  lifetimeMs: number,
): Promise<string> {
  const token = newToken();

  await authCtx.internalAdapter.createVerificationValue({
    // The endpoint reads this back as the user the token belongs to.
    value: authUserId,
    identifier: `reset-password:${token}`,
    expiresAt: new Date(Date.now() + lifetimeMs),
  });

  // `authCtx.baseURL` already includes the `/api/auth` mount point from
  // `http.ts`, so this is the deployment's own callback, not the app's. The
  // callback validates the token and then redirects the browser to
  // `callbackURL`, which must be a trusted origin - `siteUrl` is the only one.
  const callbackURL = encodeURIComponent(`${siteUrl}/reset-password`);
  return `${authCtx.baseURL}/reset-password/${token}?callbackURL=${callbackURL}`;
}

/** The staff record an operation is about, or a refusal naming the reason. */
async function loadSubject(ctx: ActionCtx, userId: Id<'users'>): Promise<Doc<'users'>> {
  const subject = (await ctx.runQuery(internal.users.load, { userId })) as Doc<'users'> | null;
  if (subject === null) throw new Error('That user no longer exists.');
  return subject;
}

/** The auth record's id, or a refusal - some operations are meaningless without one. */
function requireAuthUserId(subject: Doc<'users'>): string {
  if (subject.authUserId === null) {
    throw new Error(
      `${subject.fullName} has no sign-in account on this system, so there is nothing to change.`,
    );
  }
  return subject.authUserId;
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/**
 * Sends somebody the link that activates their account.
 *
 * An internal action rather than inline code because it is wanted three ways:
 * awaited by `invite` so the administrator learns immediately whether the mail
 * left, awaited by `resendInvitation`, and *scheduled* by `importUsers`, where
 * fifty round trips to a mail provider would outlast the action.
 *
 * It records its own outcome, including failure. An invitation that was never
 * delivered is the difference between "they are ignoring me" and "the mail server
 * is misconfigured", and only the audit trail can tell an administrator which.
 */
export const deliverInvitation = internalAction({
  args: {
    userId: v.id('users'),
    actorId: v.id('users'),
    actorLabel: v.string(),
  },
  returns: v.object({ delivered: v.boolean(), detail: v.string() }),
  handler: async (
    ctx,
    { userId, actorId, actorLabel },
  ): Promise<{ delivered: boolean; detail: string }> => {
    const subject = await loadSubject(ctx, userId);
    const authUserId = requireAuthUserId(subject);

    const authCtx = await createAuth(ctx).$context;
    const url = await mintSetPasswordLink(
      authCtx,
      authUserId,
      INVITE_TOKEN_HOURS * 60 * 60 * 1000,
    );

    const { subject: emailSubject, text, html } = invitationEmail({
      fullName: subject.fullName,
      roleLabel: ROLE_LABELS[subject.role],
      invitedBy: actorLabel,
      url,
      expiresInHours: INVITE_TOKEN_HOURS,
    });

    const result = await ctx.runAction(internal.integrations.email.index.send, {
      to: subject.email,
      subject: emailSubject,
      text,
      html,
    });

    await ctx.runMutation(internal.lib.functions.writeActionAudit, {
      at: new Date(Date.now()).toISOString(),
      actorId,
      actorLabel,
      action: 'Sent an invitation email',
      entity: 'User',
      entityId: userId,
      entityLabel: subject.fullName,
      outcome: result.delivered ? 'success' : 'failure',
      metadata: { email: subject.email, detail: result.detail },
    });

    return result;
  },
});

/**
 * Creates an account for a new member of staff.
 *
 * No password is set. The account is `invited` until the recipient follows the
 * link and chooses one, which means an invitation that is never accepted never
 * becomes a usable credential - `requireActor` refuses any account that is not
 * `active`.
 *
 * `emailVerified: true` because an administrator asserting a colleague's work
 * address is stronger evidence than a click-through, and no verification mail is
 * sent; leaving it false would mark every account in the system unverified.
 */
export const invite = authedAction({
  permission: 'user.manage',
  audit: {
    skip: 'users.insertProvisioned records the account, deliverInvitation records the email.',
  },
  args: {
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
  },
  returns: v.object({
    userId: v.id('users'),
    emailDelivered: v.boolean(),
    detail: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ userId: Id<'users'>; emailDelivered: boolean; detail: string }> => {
    const email = args.email.trim().toLowerCase();
    const fullName = args.fullName.trim().replace(/\s+/g, ' ');
    if (fullName.length < 3) throw new Error('Enter the full name (at least 3 characters).');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`"${args.email}" is not a valid email address.`);

    // Checked here for a usable error message, and again inside
    // `insertProvisioned` because only that check is race-proof.
    const clash = await ctx.runQuery(internal.users.findByEmail, { email });
    if (clash !== null) throw new Error(`${email} already has an account on this system.`);

    const authCtx = await createAuth(ctx).$context;
    const created = await authCtx.internalAdapter.createUser(
      { email, name: fullName, emailVerified: true },
      { method: 'admin' },
    );

    let userId: Id<'users'>;
    try {
      userId = await ctx.runMutation(internal.users.insertProvisioned, {
        authUserId: created.id,
        fullName,
        email,
        phone: args.phone.trim(),
        title: args.title,
        role: args.role,
        department: args.department.trim(),
        teamId: args.teamId,
        practisingLicenceNo: args.practisingLicenceNo?.trim() || null,
        firm: args.firm?.trim() || null,
        avatarColor: args.avatarColor,
        mfaRequired: args.mfaRequired,
        actorId: ctx.actor.id,
        actorLabel: ctx.actor.label,
      });
    } catch (error) {
      // See the head of this file: the auth account exists and would otherwise
      // hold the address against a retry.
      await authCtx.internalAdapter.deleteUser(created.id);
      throw error;
    }

    const result = await ctx.runAction(internal.userAccounts.deliverInvitation, {
      userId,
      actorId: ctx.actor.id,
      actorLabel: ctx.actor.label,
    });

    return { userId, emailDelivered: result.delivered, detail: result.detail };
  },
});

/**
 * Issues a fresh invitation link.
 *
 * Needed because the link expires and the first one is routinely missed - it
 * arrives while somebody is on leave, or their mailbox eats it. Every call mints a
 * new token, so an older link stops working the moment its expiry passes rather
 * than accumulating live tokens for one account.
 */
export const resendInvitation = authedAction({
  permission: 'user.manage',
  audit: { skip: 'deliverInvitation records the email it sends.' },
  args: { userId: v.id('users') },
  returns: v.object({ delivered: v.boolean(), detail: v.string() }),
  handler: async (ctx, { userId }): Promise<{ delivered: boolean; detail: string }> => {
    const subject = await loadSubject(ctx, userId);
    if (subject.status !== 'invited') {
      throw new Error(
        `${subject.fullName} has already activated their account. Send a password reset instead.`,
      );
    }

    return await ctx.runAction(internal.userAccounts.deliverInvitation, {
      userId,
      actorId: ctx.actor.id,
      actorLabel: ctx.actor.label,
    });
  },
});

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

/**
 * Sends a user a password reset on an administrator's instruction.
 *
 * Distinct from the self-service route in two ways that matter. It is attributed
 * to the administrator, so the trail shows who ordered it rather than implying the
 * user asked. And it is refused for an account that has never been activated,
 * because the right instrument there is a new invitation - the reset wording would
 * tell somebody their password had changed when they never had one.
 *
 * It does **not** unlock a locked account. The prototype cleared the failure
 * counter here, which quietly conflated "help them back in" with "lift a security
 * measure"; `users.unlock` is the deliberate act, and the UI offers both.
 */
export const sendPasswordReset = authedAction({
  permission: 'user.manage',
  audit: { entity: 'User', action: 'Sent a password reset link' },
  args: { userId: v.id('users') },
  returns: v.object({ delivered: v.boolean(), detail: v.string() }),
  handler: async (ctx, { userId }): Promise<{ delivered: boolean; detail: string }> => {
    const subject = await loadSubject(ctx, userId);
    const authUserId = requireAuthUserId(subject);
    if (subject.status === 'invited') {
      throw new Error(
        `${subject.fullName} has not activated their account yet. Resend their invitation instead.`,
      );
    }

    const authCtx = await createAuth(ctx).$context;
    const url = await mintSetPasswordLink(authCtx, authUserId, RESET_TOKEN_MINUTES * 60 * 1000);

    const { subject: emailSubject, text, html } = passwordResetEmail(
      subject.fullName,
      url,
      RESET_TOKEN_MINUTES,
    );

    const result = await ctx.runAction(internal.integrations.email.index.send, {
      to: subject.email,
      subject: emailSubject,
      text,
      html,
    });

    await ctx.audit({
      entityId: userId,
      entityLabel: subject.fullName,
      outcome: result.delivered ? 'success' : 'failure',
      metadata: { email: subject.email, detail: result.detail },
    });

    return result;
  },
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Disables or re-enables an account.
 *
 * The revocation is the part that makes this real. Without it a disabled user
 * keeps working from an open tab until their token expires, which on a twelve-hour
 * session is most of a working day - and "we removed their access this morning"
 * would be false. Deleting their Better Auth sessions fires the same hook that
 * ordinary sign-out does, so `userSessions` is marked revoked without this
 * function touching it.
 *
 * Locked accounts are not reachable from here; `users.unlock` handles those,
 * because clearing a lockout also has to clear the counter that caused it.
 */
export const setStatus = authedAction({
  permission: 'user.manage',
  audit: { skip: 'users.applyStatus records the transition inside the transaction.' },
  args: {
    userId: v.id('users'),
    status: v.union(v.literal('active'), v.literal('disabled')),
  },
  returns: v.null(),
  handler: async (ctx, { userId, status }): Promise<null> => {
    const subject = await loadSubject(ctx, userId);

    if (subject._id === ctx.actor.id && status === 'disabled') {
      throw new Error('You cannot disable your own account.');
    }
    if (subject.status === 'locked' && status === 'active') {
      throw new Error('That account is locked. Use Unlock, which also clears the failure count.');
    }

    // First, and transactional: this is what every later request is checked
    // against, and it carries the last-administrator guard. See the head of the
    // file on why this order and not the other.
    await ctx.runMutation(internal.users.applyStatus, {
      userId,
      status,
      actorId: ctx.actor.id,
      actorLabel: ctx.actor.label,
      action: status === 'active' ? 'Re-enabled a user account' : 'Disabled a user account',
    });

    if (status !== 'active' && subject.authUserId !== null) {
      const authCtx = await createAuth(ctx).$context;
      await authCtx.internalAdapter.deleteUserSessions(subject.authUserId);
    }

    return null;
  },
});

// ---------------------------------------------------------------------------
// Second factors
// ---------------------------------------------------------------------------

/**
 * Removes an enrolled authenticator so the user can enrol a new one.
 *
 * The case this exists for is a lost or replaced phone, which is common enough
 * that without it the only remedy is an administrator editing the auth tables.
 * It clears enrolment and nothing else: if the role rule or `mfaRequired` demanded
 * a second factor, that demand survives, so the user's next sign-in lands on the
 * enrolment screen rather than granting them an exemption they did not earn.
 *
 * `mfaEnabled` on the staff record is not written here. `updateUser` fires the
 * `user.update.after` hook, which mirrors `twoFactorEnabled` across - the same
 * path an ordinary self-service enrolment takes.
 */
export const clearMfaEnrolment = authedAction({
  permission: 'user.manage',
  audit: { entity: 'User', action: 'Cleared an enrolled authenticator' },
  args: { userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { userId }): Promise<null> => {
    const subject = await loadSubject(ctx, userId);
    const authUserId = requireAuthUserId(subject);
    if (!subject.mfaEnabled) {
      throw new Error(`${subject.fullName} has no authenticator enrolled.`);
    }

    const authCtx = await createAuth(ctx).$context;
    await authCtx.internalAdapter.updateUser(authUserId, { twoFactorEnabled: false });
    // The secret and recovery codes, which the flag alone would leave behind.
    await authCtx.adapter.delete({
      model: 'twoFactor',
      where: [{ field: 'userId', value: authUserId }],
    });

    await ctx.audit({
      entityId: userId,
      entityLabel: subject.fullName,
      // `mfaRequired` was optional while the backfill migration ran; treat a
      // missing value as the pre-migration default (false).
      metadata: { stillRequired: subject.mfaRequired ?? false },
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Email address
// ---------------------------------------------------------------------------

/**
 * Changes the address a user signs in with.
 *
 * Better Auth first, deliberately: it holds the record sign-in reads, and the
 * domain field is mirrored by the `user.update.after` hook. Writing the domain
 * row first would produce an account whose displayed address is not the one that
 * works.
 *
 * The old value is read before the change so the audit row can state what it was;
 * afterwards it is gone from both stores.
 */
export const changeEmail = authedAction({
  permission: 'user.manage',
  audit: { skip: 'users.recordEmailChange records it, with the previous address.' },
  args: { userId: v.id('users'), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, email }): Promise<null> => {
    const subject = await loadSubject(ctx, userId);
    const authUserId = requireAuthUserId(subject);

    const next = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      throw new Error(`"${email}" is not a valid email address.`);
    }
    if (next === subject.email) return null;

    const taken = await ctx.runQuery(internal.users.findByEmail, { email: next });
    if (taken !== null) throw new Error(`${next} already has an account on this system.`);

    const authCtx = await createAuth(ctx).$context;
    await authCtx.internalAdapter.updateUser(authUserId, { email: next, emailVerified: true });

    await ctx.runMutation(internal.users.recordEmailChange, {
      userId,
      from: subject.email,
      to: next,
      actorId: ctx.actor.id,
      actorLabel: ctx.actor.label,
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Ends one signed-in session.
 *
 * Two callers with different rights, which is why the permission is resolved in
 * the handler rather than declared: the profile page lets anybody end their own
 * sessions - the control that makes "sign out everywhere" possible after losing a
 * laptop - while Admin -> System lets an administrator end anybody's, and that
 * needs `user.manage`.
 *
 * Better Auth deletes sessions by token, not by id, so the projection's
 * `authSessionId` has to be resolved against its session list first. If it is not
 * there, the auth session has already expired and been swept; the projection is
 * then marked revoked directly, because a row advertising a session that ended
 * weeks ago is worse than no row.
 */
export const revokeSession = authedAction({
  permission: null,
  audit: { entity: 'Session', action: 'Revoked a session' },
  args: { sessionId: v.id('userSessions') },
  returns: v.null(),
  handler: async (ctx, { sessionId }): Promise<null> => {
    const session = await ctx.runQuery(internal.users.sessionById, { sessionId });
    if (session === null) throw new Error('That session no longer exists.');
    if (session.revokedAt !== null) throw new Error('That session has already ended.');

    const isOwn = session.userId === ctx.actor.id;
    if (!isOwn && !ctx.actor.can('user.manage')) {
      throw new Error('You do not have permission to end another user’s session.');
    }

    const subject = await loadSubject(ctx, session.userId);
    let endedInAuth = false;

    if (subject.authUserId !== null && session.authSessionId !== null) {
      const authCtx = await createAuth(ctx).$context;
      const live = await authCtx.internalAdapter.listSessions(subject.authUserId);
      const match = live.find((entry) => entry.id === session.authSessionId);
      if (match !== undefined) {
        // Deleting fires `session.delete.after`, which stamps `revokedAt` on the
        // projection - so nothing else needs to touch it.
        await authCtx.internalAdapter.deleteSessions([match.token]);
        endedInAuth = true;
      }
    }

    if (!endedInAuth) {
      await ctx.runMutation(internal.users.markSessionRevoked, { sessionId });
    }

    await ctx.audit({
      entityId: sessionId,
      entityLabel: `${subject.fullName} — ${session.authSessionId ?? 'unknown session'}`,
      metadata: { own: isOwn, alreadyExpired: !endedInAuth },
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------

/**
 * Invites a batch of users from a parsed spreadsheet.
 *
 * **Row-by-row, not all-or-nothing.** A department's staff list will have one bad
 * address in it, and failing the whole import over that would mean fixing the file
 * and re-running it against a system that already holds the good rows - producing
 * a duplicate storm. So each row is attempted independently and the result says
 * what happened to each, which is what the dialog reports back.
 *
 * **Every row is validated again here.** `BulkImportUsersDialog` checks the file
 * before uploading, but client-side validation is a convenience, and two rows in
 * one file can name the same address - a collision no per-row client check sees.
 *
 * **The emails are scheduled, not sent.** Fifty round trips to a mail provider,
 * each with a fifteen-second ceiling, would outlast the action; scheduling hands
 * them to the runtime one at a time and each records its own delivery outcome.
 */
export const importUsers = authedAction({
  permission: 'user.manage',
  audit: { entity: 'User', action: 'Imported users from a file' },
  args: {
    rows: v.array(
      v.object({
        fullName: v.string(),
        email: v.string(),
        phone: v.string(),
        title: staffTitleValidator,
        role: roleValidator,
        department: v.string(),
        teamId: v.union(v.id('teams'), v.null()),
        avatarColor: v.string(),
        mfaRequired: v.boolean(),
      }),
    ),
  },
  returns: v.object({
    created: v.number(),
    failed: v.number(),
    results: v.array(
      v.object({ email: v.string(), created: v.boolean(), detail: v.string() }),
    ),
  }),
  handler: async (
    ctx,
    { rows },
  ): Promise<{
    created: number;
    failed: number;
    results: { email: string; created: boolean; detail: string }[];
  }> => {
    if (rows.length === 0) throw new Error('The file contained no rows to import.');
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new Error(
        `That file has ${rows.length} rows; this import handles up to ${MAX_IMPORT_ROWS} at a time. Split it and run it again.`,
      );
    }

    const authCtx = await createAuth(ctx).$context;
    const results: { email: string; created: boolean; detail: string }[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const email = row.email.trim().toLowerCase();
      const fullName = row.fullName.trim().replace(/\s+/g, ' ');

      const reject = (detail: string) => {
        results.push({ email: row.email.trim(), created: false, detail });
      };

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        reject('Not a valid email address.');
        continue;
      }
      if (fullName.length < 3) {
        reject('Full name is missing or too short.');
        continue;
      }
      if (seen.has(email)) {
        reject('Appears more than once in this file.');
        continue;
      }
      seen.add(email);

      const clash = await ctx.runQuery(internal.users.findByEmail, { email });
      if (clash !== null) {
        reject('Already has an account on this system.');
        continue;
      }

      let authUserId: string | null = null;
      try {
        const created = await authCtx.internalAdapter.createUser(
          { email, name: fullName, emailVerified: true },
          { method: 'admin' },
        );
        authUserId = created.id;

        const userId = await ctx.runMutation(internal.users.insertProvisioned, {
          authUserId: created.id,
          fullName,
          email,
          phone: row.phone.trim(),
          title: row.title,
          role: row.role,
          department: row.department.trim(),
          teamId: row.teamId,
          practisingLicenceNo: null,
          firm: null,
          avatarColor: row.avatarColor,
          // Optional while the backfill migration ran; missing -> false.
          mfaRequired: row.mfaRequired ?? false,
          actorId: ctx.actor.id,
          actorLabel: ctx.actor.label,
        });

        await ctx.scheduler.runAfter(0, internal.userAccounts.deliverInvitation, {
          userId,
          actorId: ctx.actor.id,
          actorLabel: ctx.actor.label,
        });

        results.push({ email, created: true, detail: 'Invited.' });
      } catch (error) {
        // Same compensation as `invite`, per row: an orphaned auth account would
        // hold the address against the operator's corrected re-run.
        if (authUserId !== null) {
          await authCtx.internalAdapter.deleteUser(authUserId).catch(() => undefined);
        }
        reject(error instanceof Error ? error.message : 'Could not be created.');
      }
    }

    const created = results.filter((result) => result.created).length;

    // One row for the batch. Each account also has its own from
    // `insertProvisioned`, so this is the summary an auditor reads first, not a
    // substitute for the detail.
    await ctx.audit({
      entityId: ctx.actor.id,
      entityLabel: `${created} of ${rows.length} rows`,
      outcome: created === rows.length ? 'success' : 'failure',
      metadata: { submitted: rows.length, created, failed: rows.length - created },
    });

    return { created, failed: rows.length - created, results };
  },
});
