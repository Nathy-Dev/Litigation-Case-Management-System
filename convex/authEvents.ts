import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { loadSettings } from './lib/actor';
import { checkPassword, policyFrom } from './shared/password';

/**
 * HYPREP LCMS - the authentication event log, and the lockout.
 *
 * Everything here is called from a Better Auth hook rather than from a client.
 * That is not an implementation detail, it is the whole reason the module exists:
 * the events worth recording about authentication are mostly *failures*, and a
 * failure inside a Convex mutation rolls its own audit row back with it. So a
 * refused sign-in has to be recorded from outside the transaction that refused
 * it - which is exactly what a hook on the HTTP path is.
 *
 * The HTTP boundary is also the only place `ipAddress` and `userAgent` genuinely
 * exist. The prototype wrote a hardcoded `'105.112.44.18'` on every audit row and
 * read `navigator.userAgent` in the browser; both are now real, and both are
 * `null` on rows written from ordinary mutations rather than invented.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const requestContext = {
  ipAddress: v.union(v.string(), v.null()),
  userAgent: v.union(v.string(), v.null()),
};

async function userByEmail(ctx: MutationCtx, email: string): Promise<Doc<'users'> | null> {
  return await ctx.db
    .query('users')
    .withIndex('by_email', (q) => q.eq('email', email))
    .unique();
}

async function userByAuthId(ctx: MutationCtx, authUserId: string): Promise<Doc<'users'> | null> {
  return await ctx.db
    .query('users')
    .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
    .unique();
}

/**
 * What to call the device in the "signed-in devices" list.
 *
 * Deliberately coarse. A full user-agent database would be a dependency and a
 * maintenance burden to answer a question the screen asks casually - the user is
 * looking for "is one of these not me", and "Windows PC / Chrome / 105.112.44.18"
 * answers it. Order matters: Edge and Opera both claim Chrome, and Chrome claims
 * Safari, so the most specific test has to come first.
 */
function describeAgent(userAgent: string | null): { device: string; browser: string } {
  const ua = userAgent ?? '';

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Unknown browser';

  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android device'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows PC'
            : /Linux/.test(ua)
              ? 'Linux PC'
              : 'Unknown device';

  return { device, browser };
}

/** Writes an audit row from a non-transactional caller, with the request detail. */
async function writeAuditRow(
  ctx: MutationCtx,
  row: {
    actorId: Id<'users'> | null;
    actorLabel: string;
    action: string;
    entityId: string;
    entityLabel: string;
    outcome: 'success' | 'failure';
    ipAddress: string | null;
    userAgent: string | null;
    metadata?: Record<string, string | number | boolean>;
  },
): Promise<void> {
  await ctx.db.insert('auditLog', {
    at: new Date(Date.now()).toISOString(),
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    action: row.action,
    entity: 'Session',
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    outcome: row.outcome,
    metadata: row.metadata ?? {},
  });
}

// ---------------------------------------------------------------------------
// Sign-in gate
// ---------------------------------------------------------------------------

/**
 * Whether this email is allowed to attempt a sign-in at all.
 *
 * `requireActor` already refuses every request from an account that is not
 * `active`, so this is not the security boundary - it exists so that a locked-out
 * lawyer is told they are locked out and to contact an administrator, instead of
 * being told their password is wrong five more times.
 *
 * The cost is that an unauthenticated caller can learn whether an address is on
 * the register and what state it is in. That is a real disclosure and it is
 * accepted deliberately: the register is a closed government roster rather than a
 * public sign-up, the messages are the ones the TOR's lockout requirement implies,
 * and Better Auth's rate limiter caps how fast the surface can be probed. The
 * alternative - a generic "invalid credentials" for a locked account - hides the
 * one fact the legitimate user needs.
 */
export const signInGate = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique();

    // No staff record is not refused here. It is refused on the request path by
    // `requireActor`, and answering "no such account" before a password has been
    // offered would turn this into an address-harvesting endpoint.
    if (user === null) return null;

    switch (user.status) {
      case 'locked':
        return 'This account is locked after too many failed sign-in attempts. Contact an administrator.';
      case 'disabled':
        return 'This account has been disabled.';
      case 'invited':
        return 'This invitation has not been accepted yet. Use the link in your invitation email.';
      default:
        return null;
    }
  },
});

/**
 * Applies the live password policy, returning the reason to refuse or `null`.
 *
 * The check happens here rather than being read out as a policy object and applied
 * in the hook, so that the hook makes one round trip and the rule is evaluated in
 * exactly one place - `convex/shared/password.ts`, which the profile form also
 * imports.
 */
export const rejectWeakPassword = internalQuery({
  args: { password: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { password }) => checkPassword(password, policyFrom(await loadSettings(ctx))),
});

/**
 * Whether SSO is switched on right now.
 *
 * Read fresh from the `settings` singleton on every OIDC sign-in attempt, so
 * toggling `ssoEnabled` in Admin -> System takes effect immediately. This is
 * the same pattern as every other runtime-editable setting: Better Auth reads
 * its construction-time config once, so anything an administrator can change
 * has to be enforced in a hook that can read the live value.
 */
export const isSsoEnabled = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const settings = await loadSettings(ctx);
    return settings?.ssoEnabled ?? false;
  },
});

// ---------------------------------------------------------------------------
// Failed sign-in and lockout
// ---------------------------------------------------------------------------

/**
 * Records a rejected sign-in and locks the account at the configured threshold.
 *
 * A direct port of `authStore.ts`'s lockout, moved to where it can no longer be
 * bypassed: the prototype counted attempts in browser memory, so a page refresh
 * reset the counter to zero and the lock was theatre.
 *
 * An unknown address still gets an audit row. Somebody trying addresses against
 * the register is the single most interesting thing the trail can show, and
 * dropping those rows because they match no user would hide it.
 */
export const recordSignInFailure = internalMutation({
  args: { email: v.string(), ...requestContext },
  returns: v.null(),
  handler: async (ctx, { email, ipAddress, userAgent }) => {
    const user = await userByEmail(ctx, email);

    if (user === null) {
      await writeAuditRow(ctx, {
        actorId: null,
        actorLabel: email,
        action: 'Failed sign-in attempt',
        entityId: email,
        entityLabel: `${email} — no such account`,
        outcome: 'failure',
        ipAddress,
        userAgent,
      });
      return null;
    }

    const settings = await loadSettings(ctx);
    const threshold = settings?.maxFailedLoginAttempts ?? 5;
    const attempts = user.failedLoginAttempts + 1;
    const nowLocked = user.status === 'active' && attempts >= threshold;

    await ctx.db.patch(user._id, {
      failedLoginAttempts: attempts,
      ...(nowLocked ? { status: 'locked' as const, lockedAt: new Date(Date.now()).toISOString() } : {}),
    });

    await writeAuditRow(ctx, {
      actorId: user._id,
      actorLabel: user.fullName,
      action: 'Failed sign-in attempt',
      entityId: user._id,
      entityLabel: `${user.fullName} — invalid password`,
      outcome: 'failure',
      ipAddress,
      userAgent,
      metadata: { attempt: attempts, threshold },
    });

    if (nowLocked) {
      await writeAuditRow(ctx, {
        actorId: user._id,
        actorLabel: user.fullName,
        action: 'Account locked after repeated failed sign-ins',
        entityId: user._id,
        entityLabel: user.fullName,
        outcome: 'failure',
        ipAddress,
        userAgent,
        metadata: { attempts, threshold },
      });
    }

    return null;
  },
});

/**
 * Clears the failure counter once the password has been accepted.
 *
 * Runs on a correct password, before any second factor. That is intentional: the
 * counter exists to stop password guessing, and the password has stopped being
 * guessable at this point. A wrong authenticator code is a different problem with
 * a different control - Better Auth's own rate limiter, configured in `auth.ts`.
 */
export const recordPasswordAccepted = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, { email }) => {
    const user = await userByEmail(ctx, email);
    if (user === null || user.failedLoginAttempts === 0) return null;
    await ctx.db.patch(user._id, { failedLoginAttempts: 0 });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Projects a new Better Auth session into `userSessions`.
 *
 * Two jobs. It backs the "signed-in devices" lists in the profile and admin
 * screens, which need device, browser, IP and location - detail that only exists
 * at the HTTP boundary and that Better Auth's own session row does not carry in a
 * displayable form. And `revokedAt` on this row is what makes revocation take
 * effect immediately: see the note in `lib/actor.ts`.
 *
 * Driven by a database hook on session creation rather than by matching the
 * sign-in path, so it covers password sign-in, completion of a second factor, and
 * SSO without three places to keep in step.
 */
export const recordSessionCreated = internalMutation({
  args: {
    authUserId: v.string(),
    authSessionId: v.string(),
    expiresAt: v.number(),
    ...requestContext,
  },
  returns: v.null(),
  handler: async (ctx, { authUserId, authSessionId, expiresAt, ipAddress, userAgent }) => {
    const user = await userByAuthId(ctx, authUserId);
    // An auth account with no staff record cannot do anything (`requireActor`
    // refuses it), so there is no device to list and nothing to project.
    if (user === null) return null;

    const at = new Date(Date.now()).toISOString();
    const { device, browser } = describeAgent(userAgent);

    await ctx.db.insert('userSessions', {
      userId: user._id,
      authSessionId,
      device,
      browser,
      ipAddress: ipAddress ?? 'Unknown',
      // No geo-IP lookup: the TOR does not ask for one, and a fabricated city is
      // worse than an honest blank on a screen used to spot an unfamiliar login.
      location: 'Unknown',
      startedAt: at,
      lastSeenAt: at,
      expiresAt,
      revokedAt: null,
    });

    await ctx.db.patch(user._id, { lastLoginAt: at, failedLoginAttempts: 0 });

    await writeAuditRow(ctx, {
      actorId: user._id,
      actorLabel: user.fullName,
      action: 'Signed in',
      entityId: authSessionId,
      entityLabel: `${user.fullName} — ${user.mfaEnabled ? 'password + authenticator' : 'password'}`,
      outcome: 'success',
      ipAddress,
      userAgent,
      metadata: { mfa: user.mfaEnabled, role: user.role, device, browser },
    });

    return null;
  },
});

/**
 * Why a session ended, in the words the audit trail uses.
 *
 * Three outcomes rather than a "was this the user" boolean, because a password
 * change sweeps every other session as a security measure and recording that as
 * "signed out remotely" would send a reader looking for an administrator who was
 * never involved.
 */
const SESSION_END_ACTION = {
  self: 'Signed out',
  revoked: 'Signed out a session remotely',
  password: 'Signed out by a password change',
} as const;

/**
 * Marks a projected session ended, however it ended.
 *
 * Driven by a database hook, so every route into it lands here: the user pressing
 * "Sign out", an administrator revoking a device, a password change or reset
 * sweeping the rest, and disabling an account.
 */
export const recordSessionEnded = internalMutation({
  args: {
    authSessionId: v.string(),
    reason: v.union(v.literal('self'), v.literal('revoked'), v.literal('password')),
  },
  returns: v.null(),
  handler: async (ctx, { authSessionId, reason }) => {
    const projection = await ctx.db
      .query('userSessions')
      .withIndex('by_authSessionId', (q) => q.eq('authSessionId', authSessionId))
      .unique();
    if (projection === null || projection.revokedAt !== null) return null;

    const at = new Date(Date.now()).toISOString();
    await ctx.db.patch(projection._id, { revokedAt: at, lastSeenAt: at });

    const user = await ctx.db.get(projection.userId);
    await writeAuditRow(ctx, {
      actorId: projection.userId,
      actorLabel: user?.fullName ?? 'Unknown user',
      action: SESSION_END_ACTION[reason],
      entityId: authSessionId,
      entityLabel: `${projection.device} · ${projection.browser}`,
      outcome: 'success',
      ipAddress: projection.ipAddress,
      userAgent: null,
    });

    return null;
  },
});

export const recordSessionRefreshed = internalMutation({
  args: { authUserId: v.string(), authSessionId: v.string(), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const projection = await ctx.db.query('userSessions').withIndex('by_authSessionId', (query) => query.eq('authSessionId', args.authSessionId)).unique();
    const user = await userByAuthId(ctx, args.authUserId);
    if (projection && user && projection.userId === user._id && projection.revokedAt === null) await ctx.db.patch(projection._id, { expiresAt: args.expiresAt });
    return null;
  },
});

/**
 * Records that a reset link was issued, and whether it actually left.
 *
 * Worth a row of its own rather than folding into the eventual "Changed
 * password". Two of the three ways this ends leave no other trace: a link nobody
 * clicks, and a link that never arrived because the deployment has no email
 * provider configured. Support is asked about both, and "the email was not sent -
 * EMAIL_FROM is not set" is a five-second answer where silence is an afternoon.
 *
 * It is also the row that shows somebody else asking for resets on an address
 * they do not own, which is why the outcome is `failure` when nothing was sent:
 * the reader is looking for the attempts that did not complete.
 */
export const recordPasswordResetSent = internalMutation({
  args: { email: v.string(), delivered: v.boolean(), detail: v.string(), ...requestContext },
  returns: v.null(),
  handler: async (ctx, { email, delivered, detail, ipAddress, userAgent }) => {
    const user = await userByEmail(ctx, email);

    await writeAuditRow(ctx, {
      actorId: user?._id ?? null,
      actorLabel: user?.fullName ?? email,
      action: delivered ? 'Requested a password reset' : 'Password reset email could not be sent',
      entityId: user?._id ?? email,
      entityLabel: delivered ? `${user?.fullName ?? email} — reset link sent` : detail,
      outcome: delivered ? 'success' : 'failure',
      ipAddress,
      userAgent,
      metadata: { delivered, detail },
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Keeping the two user tables in step
// ---------------------------------------------------------------------------

/**
 * Mirrors the Better Auth user record onto the domain user.
 *
 * Better Auth owns credentials, and two of the facts it owns drive domain rules:
 * `twoFactorEnabled` decides whether `mfaRequiredForRoles` is satisfied, and the
 * email is the address the register displays and matches on. Both are changed
 * through Better Auth's own endpoints, so neither can be maintained by the
 * mutation that "would have" changed it - there isn't one.
 *
 * Driven by a database hook on the auth user record, which is the only place that
 * sees every write to it. The alternative, syncing at read time in `api.auth.me`,
 * would need a query to write.
 */
export const syncFromAuthUser = internalMutation({
  args: {
    authUserId: v.string(),
    email: v.union(v.string(), v.null()),
    twoFactorEnabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { authUserId, email, twoFactorEnabled }) => {
    const user = await userByAuthId(ctx, authUserId);
    if (user === null) return null;

    const patch: Partial<Doc<'users'>> = {};
    if (email !== null && email !== user.email) patch.email = email;
    if (twoFactorEnabled !== user.mfaEnabled) patch.mfaEnabled = twoFactorEnabled;
    if (Object.keys(patch).length === 0) return null;

    await ctx.db.patch(user._id, patch);

    if (patch.mfaEnabled !== undefined) {
      await writeAuditRow(ctx, {
        actorId: user._id,
        actorLabel: user.fullName,
        action: twoFactorEnabled
          ? 'Enrolled in two-factor authentication'
          : 'Removed two-factor authentication',
        entityId: user._id,
        entityLabel: user.fullName,
        outcome: 'success',
        ipAddress: null,
        userAgent: null,
      });
    }

    return null;
  },
});

/**
 * Stamps `passwordChangedAt`, which is what the expiry rule measures from.
 *
 * Better Auth stores the hash and has no opinion about expiry, so the domain row
 * has to be told. Without this the TOR's `passwordExpiryDays` rule would keep
 * demanding a change from someone who had just made one.
 */
export const recordPasswordChanged = internalMutation({
  args: { authUserId: v.string(), ...requestContext },
  returns: v.null(),
  handler: async (ctx, { authUserId, ipAddress, userAgent }) => {
    const user = await userByAuthId(ctx, authUserId);
    if (user === null) return null;

    await ctx.db.patch(user._id, { passwordChangedAt: new Date(Date.now()).toISOString() });

    await writeAuditRow(ctx, {
      actorId: user._id,
      actorLabel: user.fullName,
      action: 'Changed password',
      entityId: user._id,
      entityLabel: user.fullName,
      outcome: 'success',
      ipAddress,
      userAgent,
    });

    return null;
  },
});
