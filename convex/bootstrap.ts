import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery } from './_generated/server';
import { createAuth } from './auth';
import { initialsFrom } from './shared/pure';

/**
 * HYPREP LCMS - the one-shot first administrator.
 *
 * Sign-up is closed (`auth.ts`), so every account is created by an existing
 * administrator - which leaves the obvious question of where the first one comes
 * from. This is that door, and it is the only privileged path in the deployment
 * that no signed-in user is behind, so it is worth being precise about what
 * closes it.
 *
 * **Two independent gates, both of which must pass.**
 *
 * 1. `BOOTSTRAP_SECRET` must be set as a deployment environment variable, and the
 *    caller must present it. Setting a deployment variable requires the Convex
 *    dashboard or CLI credentials, so possession of the secret means possession of
 *    the deployment. If the variable is unset the endpoint refuses outright: a
 *    deployment that never sets it has no bootstrap surface at all, rather than
 *    one guarded by an empty string.
 * 2. The `users` table must be empty. Once a single staff record exists this
 *    endpoint is permanently closed, whatever the secret says - so leaving
 *    `BOOTSTRAP_SECRET` set after go-live is untidy rather than dangerous. It
 *    should still be removed, and the success message says so.
 *
 * The emptiness test is repeated inside the transaction that writes the row, not
 * only in the action that checks first, because an action is not a transaction and
 * two operators racing would otherwise both pass the check.
 *
 * **The account it creates is deliberately not exempt from anything.** It gets
 * `SUPER_ADMIN`, and `settings.mfaRequiredForRoles` includes `SUPER_ADMIN`, so the
 * very first thing this account is made to do on signing in is enrol an
 * authenticator. `passwordChangedAt` is stamped now, so the expiry clock starts
 * at bootstrap rather than at the epoch. A bootstrap that quietly skipped the
 * controls it exists to switch on would be the wrong kind of convenient.
 */

/**
 * Compares two secrets without leaking where they diverge.
 *
 * Digest first, then compare: SHA-256 output is fixed-length, so the loop below
 * runs the same number of iterations whatever was submitted and the comparison
 * cannot leak the secret's length either. A plain `===` on the raw strings would
 * return on the first differing byte, which over enough attempts is a way to
 * learn the secret one character at a time.
 */
async function secretMatches(submitted: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(submitted)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);

  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

/** Whether any staff record exists at all - the gate that closes permanently. */
export const registerIsEmpty = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => (await ctx.db.query('users').first()) === null,
});

/**
 * Writes the domain staff record for an auth account that has just been created.
 *
 * Separate from the action because only a mutation can be trusted to check and
 * write atomically, and the check is the whole security property. If this throws,
 * the action deletes the auth account it made rather than leaving a credential
 * with no staff record behind.
 */
export const claimFirstSuperAdmin = internalMutation({
  args: {
    authUserId: v.string(),
    fullName: v.string(),
    email: v.string(),
    phone: v.string(),
    department: v.string(),
  },
  returns: v.id('users'),
  handler: async (ctx, { authUserId, fullName, email, phone, department }): Promise<Id<'users'>> => {
    if ((await ctx.db.query('users').first()) !== null) {
      throw new Error(
        'The register is no longer empty, so the bootstrap is closed. Ask an existing administrator to invite you.',
      );
    }

    const now = new Date(Date.now()).toISOString();

    const userId = await ctx.db.insert('users', {
      authUserId,
      fullName,
      email,
      phone,
      title: 'System Administrator',
      role: 'SUPER_ADMIN',
      department,
      teamId: null,
      practisingLicenceNo: null,
      firm: null,
      avatarColor: 'brand',
      initials: initialsFrom(fullName),
      status: 'active',
      // Not enrolled, and `mfaRequiredForRoles` will insist before this account
      // can do anything else. See the note at the head of the file.
      mfaEnabled: false,
      // No individual requirement needed: SUPER_ADMIN is in
      // `mfaRequiredForRoles`, so the role-wide rule already covers this account
      // and duplicating it here would be a second thing to keep in step.
      mfaRequired: false,
      failedLoginAttempts: 0,
      lastLoginAt: null,
      createdAt: now,
      // Starts the `passwordExpiryDays` clock here rather than leaving it null,
      // which the expiry rule would read as "never changed".
      passwordChangedAt: now,
      lockedAt: null,
    });

    await ctx.db.insert('auditLog', {
      at: now,
      actorId: userId,
      actorLabel: fullName,
      action: 'Bootstrapped the first administrator account',
      entity: 'User',
      entityId: userId,
      entityLabel: `${fullName} — SUPER_ADMIN`,
      // An action carries no request headers, and inventing an address on the one
      // row a reader is most likely to scrutinise would be the worst place to do
      // it. Every later account change is audited from a request that has them.
      ipAddress: null,
      userAgent: null,
      outcome: 'success',
      metadata: { role: 'SUPER_ADMIN', viaBootstrap: true },
    });

    return userId;
  },
});

/**
 * Creates the first `SUPER_ADMIN`, seeding reference data on the way.
 *
 * Public rather than internal, because the two gates above are the access control
 * and being callable is the point: a fresh deployment can be brought up from a
 * setup screen or from `convex run` without either path being privileged in a way
 * the other is not.
 *
 * Reference data is seeded first because nothing works without it - the
 * permission matrix is what every mutation is checked against, and the settings
 * row is what the password policy is read from. Doing it here means a fresh
 * deployment is one call away from usable, and the seeder is idempotent, so a
 * deployment that has already been seeded is unaffected.
 */
export const firstSuperAdmin = action({
  args: {
    secret: v.string(),
    fullName: v.string(),
    email: v.string(),
    password: v.string(),
    /** Both optional and both editable in Admin -> Users; blank beats invented. */
    phone: v.optional(v.string()),
    department: v.optional(v.string()),
  },
  returns: v.object({ userId: v.id('users'), message: v.string() }),
  handler: async (ctx, args) => {
    const expected = process.env.BOOTSTRAP_SECRET;
    if (!expected) {
      throw new Error(
        'Bootstrap is not enabled on this deployment. Set the BOOTSTRAP_SECRET environment variable to enable it.',
      );
    }
    if (!(await secretMatches(args.secret, expected))) {
      throw new Error('Incorrect bootstrap secret.');
    }
    if (!(await ctx.runQuery(internal.bootstrap.registerIsEmpty, {}))) {
      throw new Error(
        'This deployment already has staff accounts, so the bootstrap is closed. Ask an existing administrator to invite you.',
      );
    }

    await ctx.runMutation(internal.seed.index.referenceData, {});

    const email = args.email.trim().toLowerCase();
    const fullName = args.fullName.trim();
    if (fullName === '') throw new Error('Enter the administrator’s full name.');

    // The live policy, not Better Auth's construction-time floor. Creating the
    // account through the internal adapter bypasses the `/sign-up/email` route
    // and therefore the hook that normally applies this, so it is applied here
    // explicitly - the first password in the system should not be the one
    // password the rule does not reach.
    const weak = await ctx.runQuery(internal.authEvents.rejectWeakPassword, {
      password: args.password,
    });
    if (weak !== null) throw new Error(weak);

    const authCtx = await createAuth(ctx).$context;
    const { internalAdapter, password } = authCtx;
    const hash = await password.hash(args.password);

    /**
     * Adopt an existing auth account for this address rather than duplicating it.
     *
     * The reachable case is a bootstrap that created the credential and then
     * failed to write the staff record - a retry should finish the job, not leave
     * two accounts for one address behind. The register is empty, which is the
     * proof that no live user is being taken over here.
     */
    const existing = await internalAdapter.findUserByEmail(email, { includeAccounts: true });
    let authUserId: string;

    if (existing !== null) {
      authUserId = existing.user.id;
      const credential = existing.accounts.find((a) => a.providerId === 'credential');
      if (credential) {
        await internalAdapter.updatePassword(authUserId, hash);
      } else {
        await internalAdapter.linkAccount({
          userId: authUserId,
          providerId: 'credential',
          accountId: authUserId,
          password: hash,
        });
      }
    } else {
      const created = await internalAdapter.createUser({
        email,
        name: fullName,
        // Nobody self-registered and no verification email is sent, so leaving
        // this false would mark the account unverified forever.
        emailVerified: true,
      });
      authUserId = created.id;
      await internalAdapter.linkAccount({
        userId: authUserId,
        providerId: 'credential',
        accountId: authUserId,
        password: hash,
      });
    }

    let userId: Id<'users'>;
    try {
      userId = await ctx.runMutation(internal.bootstrap.claimFirstSuperAdmin, {
        authUserId,
        fullName,
        email,
        phone: args.phone?.trim() ?? '',
        department: args.department?.trim() ?? '',
      });
    } catch (error) {
      // Only compensate for an account this call created. Adopting an existing
      // one and then deleting it on a lost race would destroy the credential the
      // winning operator is about to need.
      if (existing === null) await internalAdapter.deleteUser(authUserId);
      throw error;
    }

    return {
      userId,
      message: `Created ${email} as SUPER_ADMIN. Sign in, enrol an authenticator when prompted, then remove the BOOTSTRAP_SECRET environment variable.`,
    };
  },
});
