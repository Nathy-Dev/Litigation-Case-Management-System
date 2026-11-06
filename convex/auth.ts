import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex, crossDomain } from '@convex-dev/better-auth/plugins';
import { requireActionCtx, requireRunMutationCtx } from '@convex-dev/better-auth/utils';
import { betterAuth } from 'better-auth/minimal';
import { APIError, createAuthMiddleware, getIP, isAPIError } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { v } from 'convex/values';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { query } from './_generated/server';
import authConfig from './auth.config';
import {
  buildActor,
  complianceFor,
  loadSettings,
  resolveCaller,
  sessionVerdict,
} from './lib/actor';
import { authedMutation } from './lib/functions';
import { passwordResetEmail } from './integrations/email/templates';
import { permissionValidator, roleValidator, userStatusValidator } from './shared/enums';

/**
 * HYPREP LCMS - authentication.
 *
 * Better Auth runs *inside* this Convex deployment as a component: it owns the
 * credential store (user, session, account, twoFactor, jwks, rateLimit) in its own
 * table namespace, mints a short-lived JWT that `auth.config.ts` teaches Convex to
 * trust, and serves its HTTP surface from `http.ts`. No third party holds staff
 * records - which for a government legal unit's case register is the point.
 *
 * Three boundaries are worth being explicit about, because each is a place the
 * obvious implementation would be wrong.
 *
 * **Authorization does not live here.** Better Auth answers "is this the person
 * they claim to be". The domain `users.role` and the runtime-editable
 * `permissionMatrix` answer "what may they do", and they are the sole authority -
 * `lib/actor.ts` reads them on every request. Better Auth's `admin()` plugin is
 * deliberately absent: its `role`/`banned` fields are not in the component's
 * schema, so it could not write them, and a second copy of the role would be
 * exactly the drift the two-table design is meant to avoid. Everything it would
 * have provided - provisioning, password reset, session revocation - is reachable
 * through `auth.$context.internalAdapter`.
 *
 * **Sign-up is closed.** `disableSignUp` is the difference between a staff
 * register and a public web app. Accounts arrive by administrator invitation
 * (`api.users.*`), by the one-shot bootstrap in `bootstrap.ts`, or by SSO
 * just-in-time provisioning, which lands a `READ_ONLY`/`invited` user requiring
 * explicit elevation. The `/sign-up/email` route is still hooked for password
 * policy, because the bootstrap and the invitation flow both go through it.
 *
 * **Some config is frozen at construction, some is not.** Better Auth reads
 * `minPasswordLength`, `session.expiresIn` and friends when the instance is built,
 * and `createAuth` is synchronous, so it cannot await the `settings` document.
 * Anything an administrator can edit at runtime is therefore enforced in a hook
 * that *can* read it - see `SESSION_MAX_HOURS` below and the hooks at the foot of
 * this file. Getting this wrong is the classic cause of "the setting saves but
 * does nothing", so each dynamic setting says where it is enforced.
 */

export const siteUrl = process.env.SITE_URL ?? 'http://localhost:5173';

/**
 * Reads a whole number of units from an environment variable.
 *
 * The validation is not decoration. Every caller below feeds a limit - a session
 * lifetime, a request ceiling - and `Number('12 ')` is fine while `Number('12h')`
 * is `NaN`, which no comparison rejects: `count >= NaN` is false, so a mistyped
 * variable would not fail loudly, it would switch the limit off and leave the
 * deployment looking configured.
 */
function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The absolute ceiling on a session's life, in hours.
 *
 * Not the same control as `settings.sessionTimeoutMinutes`, and not a substitute
 * for it. This is a hard cap on how long a single sign-in can last no matter how
 * active the user is, so a token that leaks has a bounded life; the *idle* rule
 * the TOR makes configurable is enforced against `userSessions.lastSeenAt` in
 * `sessionVerdict`, because Better Auth extends its own session whenever the
 * client renews its Convex token - which happens on a timer, awake or idle.
 *
 * An environment variable rather than a setting precisely because it is read once
 * at construction: exposing it in Admin -> Settings would be a control that
 * appears to work and does not.
 */
const SESSION_MAX_HOURS = positiveInt(process.env.SESSION_MAX_HOURS, 12);

function sessionExpiry(value: unknown): number {
  const expiry = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(expiry)) throw new Error('Invalid authentication session expiry.');
  return expiry;
}

/**
 * How long the `/sign-in/email` throttle window is, and how many tries it allows.
 *
 * These exist to be *widened* from Better Auth's default of three attempts per ten
 * seconds, which is stricter than the TOR's control and pre-empts it. The throttle
 * is resolved in the request phase, before any hook runs, so a caller who trips it
 * gets an opaque "Too many requests" - including on the attempt that would have
 * locked the account, and on every later attempt that would have said so. The
 * effect is that the one control the TOR specifies becomes invisible to the person
 * it is protecting, who is left retrying a password that is no longer the problem.
 *
 * **`SIGN_IN_RATE_MAX` must stay above `settings.maxFailedLoginAttempts`.** The
 * lockout is the stricter control by a wide margin - it is permanent until an
 * administrator lifts it, where a throttle lapses on its own - so where the two
 * disagree the lockout should be the one that fires. The margin above the
 * threshold is what leaves room for the refusal to be delivered as well as
 * incurred. The default pair below allows the shipped threshold of five to be
 * reached and reported twice over.
 *
 * The reason this is an environment variable while the threshold is a setting is
 * the usual one: `betterAuth()` reads its configuration once, at construction, so
 * a value edited in Admin -> Settings could not reach it. Raising
 * `maxFailedLoginAttempts` past `SIGN_IN_RATE_MAX` is therefore a change that also
 * needs a deployment variable, and the settings screen says so.
 */
const SIGN_IN_RATE_WINDOW_SECONDS = positiveInt(process.env.SIGN_IN_RATE_WINDOW_SECONDS, 60);
const SIGN_IN_RATE_MAX = positiveInt(process.env.SIGN_IN_RATE_MAX, 10);

/**
 * How long a password reset link stays usable, in minutes.
 *
 * An hour is Better Auth's default and is kept, but stated here rather than left
 * implicit because the email tells the reader the number and the two must agree -
 * an email promising thirty minutes on a token that lives for sixty is the kind of
 * discrepancy nobody notices until a user is arguing with support about it.
 *
 * Short on purpose. The link is a bearer credential that arrives over email and
 * grants a password change, so the window in which an intercepted message is
 * useful should be small; a user who takes too long asks again, which costs one
 * click.
 */
export const RESET_TOKEN_MINUTES = positiveInt(process.env.RESET_TOKEN_MINUTES, 60);

/**
 * Every path that sets a password, and the body field it arrives in.
 *
 * One map rather than a list of paths plus a lookup, so "is this a password path"
 * and "where is the password" cannot disagree - a path present in one and missing
 * from the other would silently skip the policy on exactly the route that needed
 * it. Membership is `PASSWORD_FIELDS[path] !== undefined`.
 */
const PASSWORD_FIELDS: Record<string, string | undefined> = {
  '/sign-up/email': 'password',
  '/change-password': 'newPassword',
  '/reset-password': 'newPassword',
  '/set-password': 'newPassword',
};

export const authComponent = createClient<DataModel>(components.betterAuth);

/**
 * Reverse proxies whose `x-forwarded-for` entries may be believed, as CIDRs.
 *
 * Empty by default, and that default is a real position rather than a stub.
 * `x-forwarded-for` is appended to hop by hop and a client can send its own, so
 * without knowing which hops are yours the header cannot be reduced to a client
 * address at all - Better Auth accordingly resolves an IP only from a
 * single-valued header and returns nothing for an unattributable chain. Naming
 * your proxies here is what lets it walk the chain from the right and stop at the
 * first hop it does not recognise.
 *
 * The tempting shortcut - take the leftmost entry - is the one thing that must not
 * be done: it lets any caller write an address of their choosing into the audit
 * trail, which is worse than a blank, because a blank does not mislead.
 */
const trustedProxies = (process.env.TRUSTED_PROXIES ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry !== '');

/**
 * The request detail an audit row can honestly carry.
 *
 * IP resolution is delegated to Better Auth rather than reimplemented, so the
 * address on a failed-sign-in row is the same address on the session row for the
 * attempt that succeeds - two rules would eventually disagree and the trail would
 * be the place it showed.
 */
function requestContext(hookCtx: {
  headers?: Headers | undefined;
  context: { options: Parameters<typeof getIP>[1] };
}): { ipAddress: string | null; userAgent: string | null } {
  const headers = hookCtx.headers ?? new Headers();
  return {
    ipAddress: blankToNull(getIP(headers, hookCtx.context.options)),
    userAgent: blankToNull(headers.get('user-agent')),
  };
}

/**
 * `null` for "not known", never an empty string.
 *
 * Better Auth writes `''` rather than leaving `ipAddress`/`userAgent` unset when a
 * request arrives without them, which is how a blank string reaches an audit row
 * that means to say "unknown" - a distinction the trail depends on, since the
 * screen renders one as a real value and the other as an honest gap.
 */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  /**
   * Every hook below writes, and writing needs a ctx that can run a mutation.
   *
   * `GenericCtx` includes a query ctx, because `createAuth` is also called from
   * `authComponent.safeGetAuthUser` inside queries. Hooks only fire on the HTTP
   * path, where the ctx is always an action - so this narrows a type that is
   * genuinely wider than the runtime, and throws loudly rather than silently
   * dropping an audit row if that ever stops being true.
   */
  const run = () => requireRunMutationCtx(ctx);

  return betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),

    emailAndPassword: {
      enabled: true,
      // Invitations are issued by an administrator, not requested. See the note
      // on closed sign-up above.
      disableSignUp: true,
      // Nobody self-registers, so there is no unverified address to guard
      // against; an administrator entering a colleague's address is the
      // verification. Turning this on would lock out every invited user until
      // transactional email lands.
      requireEmailVerification: false,
      // Better Auth's own floor. The real, administrator-editable rule is applied
      // in the `before` hook - this is only a backstop for the case where the
      // settings row does not exist yet.
      minPasswordLength: 8,
      // A password reset is the response to a compromise as often as to
      // forgetfulness, so every other session goes with it.
      revokeSessionsOnPasswordReset: true,
      // See `RESET_TOKEN_MINUTES`. Better Auth wants seconds.
      resetPasswordTokenExpiresIn: RESET_TOKEN_MINUTES * 60,

      /**
       * Sends the reset link, and records the attempt either way.
       *
       * The `url` Better Auth builds points at its own callback on the Convex
       * *site* origin, which validates the token and then redirects to
       * `callbackURL` on the app - so the address in the email is not the page the
       * user ends up on, and must not be rewritten to one. `redirectTo` is what
       * the client supplies to steer that second hop.
       *
       * Sending is awaited rather than scheduled. An action scheduled from here
       * would run after the response, which reads as tidier, but the audit row is
       * the only evidence a deployment with no configured provider produces, and
       * deferring it would leave the most common failure - "the email never
       * arrived" - visible nowhere for as long as the queue took. It is one HTTPS
       * call on a route that already writes to the database twice.
       */
      sendResetPassword: async ({ user, url }) => {
        const { subject, text, html } = passwordResetEmail(user.name, url, RESET_TOKEN_MINUTES);

        const { delivered, detail } = await requireActionCtx(ctx).runAction(
          internal.integrations.email.index.send,
          { to: user.email, subject, text, html },
        );

        await run().runMutation(internal.authEvents.recordPasswordResetSent, {
          email: user.email,
          delivered,
          detail,
          // The request is not passed to this callback in a form the shared
          // helper can read, and the route it is reached from is unauthenticated,
          // so there is no session to attribute it to either. A blank is honest;
          // the "Changed password" row that follows a completed reset carries the
          // address of whoever actually used the link.
          ipAddress: null,
          userAgent: null,
        });
      },
      // The one password path with no session and no user in its response, so it
      // cannot be audited from the `after` hook like the others. Better Auth
      // hands the user over here instead.
      onPasswordReset: async ({ user }) => {
        await run().runMutation(internal.authEvents.recordPasswordChanged, {
          authUserId: user.id,
          ipAddress: null,
          userAgent: null,
        });
      },
    },

    session: {
      expiresIn: SESSION_MAX_HOURS * 60 * 60,
      // How stale the stored session may get before a renewal rewrites it. Kept
      // well inside `expiresIn` so an active user is never signed out by the
      // absolute cap arriving unannounced.
      updateAge: Math.max(60 * 15, Math.floor((SESSION_MAX_HOURS * 60 * 60) / 4)),
    },

    // Backed by the component's `rateLimit` table rather than memory, because
    // Convex functions run in short-lived isolates - an in-memory counter would
    // reset often enough to be no limit at all. This is what caps second-factor
    // and password guessing; the account lockout in `authEvents.ts` counts only
    // failed passwords.
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: {
        // See `SIGN_IN_RATE_WINDOW_SECONDS`: widened so the account lockout, not
        // this throttle, is what a user who forgets their password runs into.
        '/sign-in/email': { window: SIGN_IN_RATE_WINDOW_SECONDS, max: SIGN_IN_RATE_MAX },
        // Same reasoning, lower stakes. The password policy refuses from a before
        // hook, and the refusal names the rule that was missed - three tries per
        // ten seconds is easily spent by someone reading the requirements off the
        // error message. Brute force is not the risk on a route that already
        // requires a live session.
        '/change-password': { window: SIGN_IN_RATE_WINDOW_SECONDS, max: SIGN_IN_RATE_MAX },
      },
    },

    advanced: {
      // Feeds both `session.ipAddress` and the rate limiter's per-IP key, so an
      // unconfigured deployment behind a proxy rate-limits every caller as one
      // bucket rather than mistaking a spoofed header for a distinct client.
      //
      // `TRUSTED_PROXIES` names the header a trusted reverse proxy sets
      // (`x-forwarded-for` by default). Only a deployment actually behind a
      // proxy should set it; on localhost the header is absent and Better Auth
      // falls back to a shared bucket, which is the correct conservative
      // behaviour.
      ipAddress: {
        ...(trustedProxies.length > 0
          ? { ipAddressHeaders: trustedProxies as string[] }
          : {}),
      },
    },


    plugins: [
      // TOTP second factor (TOR section 19's `mfaRequiredForRoles`). Enrolment is
      // driven from the client; the domain side of it - mirroring the flag onto
      // `users.mfaEnabled` so `complianceFor` can see it - happens in the user
      // database hook below.
      twoFactor({ issuer: 'HYPREP LCMS' }),
      // The SPA is served from a different origin than the Convex deployment, so
      // the session cannot live in a cookie the app can read. This moves it to a
      // token the client holds and sends.
      crossDomain({ siteUrl }),
      // Mints the JWT that `auth.config.ts` makes Convex trust, and publishes the
      // JWKS it is verified against.
      convex({ authConfig }),
      // SSO via an OIDC provider (TOR section 19's single sign-on). This is the
      // generic-oauth plugin, which speaks OAuth2/OIDC against any provider that
      // publishes a discovery document - Microsoft Entra ID, Google Workspace,
      // Keycloak, Auth0, Okta. Configured entirely by environment variables so
      // the IdP details are a deployment concern, not a code change.
      //
      // Registration is closed: `disableSignUp: true` means an OIDC user without
      // an existing account is refused rather than auto-created. The JIT
      // provisioning path - landing a READ_ONLY/invited staff record for a
      // verified IdP email - is handled in the `after` hooks below, which is the
      // only place the SSO account creation can be seen and audited.
      ...(process.env.SSO_OIDC_DISCOVERY_URL
        ? [
            genericOAuth({
              config: [
                {
                  providerId: 'oidc',
                  discoveryUrl: process.env.SSO_OIDC_DISCOVERY_URL,
                  clientId: process.env.SSO_OIDC_CLIENT_ID ?? '',
                  clientSecret: process.env.SSO_OIDC_CLIENT_SECRET,
                  scopes: ['openid', 'email', 'profile'],
                  pkce: true,
                  disableSignUp: true,
                  requireIdTokenVerification: true,
                  redirectURI: `${process.env.CONVEX_SITE_URL}/api/auth/callback/oidc`,
                  // Map the IdP's claims onto Better Auth's user shape. The email
                  // is the join key to the domain `users` table; the name is what
                  // the audit trail shows. Nothing privileged is derived here.
                  mapProfileToUser: (profile) => ({
                    email: String(profile.email ?? ''),
                    name: String(profile.name ?? profile.preferred_username ?? ''),
                  }),
                },
              ],
            }),
          ]
        : []),
    ],

    /**
     * Request hooks: the things that have to happen outside a transaction.
     *
     * A refused sign-in is the most interesting event an audit trail can hold and
     * the hardest to record, because the mutation that refuses it rolls its own
     * audit row back. Better Auth catches an endpoint's `APIError`, parks it on
     * `context.returned`, and runs the `after` hook anyway - so this is the one
     * place a failure can be written down.
     */
    hooks: {
      before: createAuthMiddleware(async (hookCtx) => {
        const { path } = hookCtx;

        // SSO is runtime-gated on `settings.ssoEnabled` (Admin -> System), so
        // switching it off in the UI must take effect immediately rather than
        // waiting for a redeploy. The OIDC sign-in entry is `/sign-in/oidc`; the
        // callback is the second hop and the session is already minted by then,
        // so the gate lives on the entry, exactly like the email gate below.
        if (
          path === '/sign-in/oidc' ||
          (path === '/sign-in/social' && hookCtx.body?.provider === 'oidc')
        ) {
          const ssoEnabled = await run().runQuery(internal.authEvents.isSsoEnabled);
          if (!ssoEnabled) {
            throw new APIError('FORBIDDEN', {
              message: 'Single sign-on is switched off. Sign in with your password instead.',
            });
          }
          return;
        }

        if (
          path === '/callback/oidc' ||
          (path === '/callback/:id' && hookCtx.params?.id === 'oidc')
        ) {
          const issuer =
            process.env.SSO_OIDC_ISSUER ??
            hookCtx.context.socialProviders.find((provider) => provider.id === 'oidc')?.issuer;
          if (!issuer || hookCtx.query?.iss !== issuer) {
            throw new APIError('FORBIDDEN', {
              message: 'Single sign-on returned an invalid issuer.',
            });
          }
        }

        if (path === '/sign-in/email') {
          const email = (hookCtx.body as { email?: unknown } | undefined)?.email;
          if (typeof email === 'string') {
            const refusal = await run().runQuery(internal.authEvents.signInGate, { email });
            // FORBIDDEN rather than UNAUTHORIZED: the credentials were never
            // examined, and the caller needs to know the difference - retyping the
            // password will not help a locked account.
            if (refusal !== null) throw new APIError('FORBIDDEN', { message: refusal });
          }
          return;
        }

        const field = PASSWORD_FIELDS[path];
        if (field !== undefined) {
          const password = (hookCtx.body as Record<string, unknown> | undefined)?.[field];
          if (typeof password === 'string') {
            const refusal = await run().runQuery(internal.authEvents.rejectWeakPassword, {
              password,
            });
            if (refusal !== null) throw new APIError('BAD_REQUEST', { message: refusal });
          }
        }
      }),

      after: createAuthMiddleware(async (hookCtx) => {
        const { path } = hookCtx;
        const failed = isAPIError(hookCtx.context.returned);

        if (path === '/sign-in/email') {
          const email = (hookCtx.body as { email?: unknown } | undefined)?.email;
          if (typeof email !== 'string') return;

          // Sign-in is two steps when a second factor is enrolled, and this fires
          // after the first. So a success here means "the password was right",
          // which is exactly what the lockout counter is about; the session, and
          // the "Signed in" audit row, come from the database hook below once the
          // second factor is satisfied too.
          await run().runMutation(
            failed
              ? internal.authEvents.recordSignInFailure
              : internal.authEvents.recordPasswordAccepted,
            failed
              ? { email, ...requestContext(hookCtx) }
              : ({ email } as { email: string }),
          );
          return;
        }

        // `/reset-password` is absent: it has no session to attribute the change
        // to, and is handled by `onPasswordReset` above instead. `/sign-up/email`
        // is absent because `recordPasswordChanged` stamps a domain user that does
        // not exist yet at that point - the provisioning path stamps it directly.
        if (!failed && (path === '/change-password' || path === '/set-password')) {
          const authUserId = hookCtx.context.session?.user.id;
          if (typeof authUserId === 'string') {
            await run().runMutation(internal.authEvents.recordPasswordChanged, {
              authUserId,
              ...requestContext(hookCtx),
            });
          }
        }
      }),
    },

    /**
     * Database hooks: the things that have to happen however they were triggered.
     *
     * Chosen over matching request paths because there are many paths into each of
     * these events and only one table write. A session is created by password
     * sign-in, by completing a second factor, by SSO, and by the cross-domain
     * one-time-token exchange; it is destroyed by sign-out, by an administrator
     * revoking it, by disabling the user, and by a password reset. Matching paths
     * would mean eight places to keep in step with two.
     */
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
              await run().runMutation(internal.authEvents.recordSessionCreated, {
                authUserId: session.userId,
                authSessionId: session.id,
                expiresAt: sessionExpiry(session.expiresAt),
              ipAddress: blankToNull(session.ipAddress),
              userAgent: blankToNull(session.userAgent),
            });
          },
        },
          delete: {
            after: async (session, context) => {
            // The path is the only evidence of *why*, and the audit trail should
            // not report an administrator who was never involved. A password
            // change and a reset both sweep sessions as a security measure; a
            // sign-out is the user; everything else is somebody else.
            const path = context?.path;
            const reason =
              path === '/sign-out'
                ? ('self' as const)
                : path === '/change-password' || path === '/reset-password'
                  ? ('password' as const)
                  : ('revoked' as const);

              await run().runMutation(internal.authEvents.recordSessionEnded, {
                authSessionId: session.id,
                reason,
              });
            },
          },
          update: {
            after: async (session) => {
              await run().runMutation(internal.authEvents.recordSessionRefreshed, { authUserId: session.userId, authSessionId: session.id, expiresAt: sessionExpiry(session.expiresAt) });
            },
          },
      },
      user: {
        update: {
          after: async (user) => {
            await run().runMutation(internal.authEvents.syncFromAuthUser, {
              authUserId: user.id,
              email: typeof user.email === 'string' ? user.email : null,
              twoFactorEnabled: user.twoFactorEnabled === true,
            });
          },
        },
      },
    },
  });
};

// ---------------------------------------------------------------------------
// What the client asks
// ---------------------------------------------------------------------------

const meUser = v.object({
  id: v.id('users'),
  fullName: v.string(),
  email: v.string(),
  phone: v.union(v.string(), v.null()),
  title: v.string(),
  role: roleValidator,
  department: v.string(),
  teamId: v.union(v.id('teams'), v.null()),
  practisingLicenceNo: v.union(v.string(), v.null()),
  firm: v.union(v.string(), v.null()),
  avatarColor: v.string(),
  initials: v.string(),
  status: userStatusValidator,
  mfaEnabled: v.boolean(),
  lastLoginAt: v.union(v.string(), v.null()),
  createdAt: v.string(),
});

/**
 * Everything the app needs to decide what to render, in one subscription.
 *
 * A plain `query`, not `authedQuery`, and that is the whole design of it: every
 * other function may throw at a caller who is not allowed in, but this one has to
 * *describe* the refusal, because the client's job is to route to the screen that
 * fixes it. A thrown error cannot say "you are signed in but not on the register"
 * or "your session went idle" in a form a router can branch on.
 *
 * Hence the discriminated union. `null` is the only ambiguous value - it means not
 * signed in - and `<Unauthenticated>` handles it before this query is even asked.
 *
 * Being reactive matters more than it looks. An administrator editing the
 * permission matrix, disabling an account, or revoking a session invalidates this
 * query for the affected client, and every button, route guard and menu item
 * re-evaluates within the round trip. The prototype's permission checks were
 * client-side constants; these are server-resolved and live.
 */
export const me = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ kind: v.literal('no-account'), email: v.union(v.string(), v.null()) }),
    v.object({ kind: v.literal('blocked'), status: userStatusValidator }),
    v.object({ kind: v.literal('session-ended'), reason: v.string() }),
    v.object({
      kind: v.literal('active'),
      user: meUser,
      permissions: v.array(permissionValidator),
      mustEnrolMfa: v.boolean(),
      mustChangePassword: v.boolean(),
      sessionTimeoutMinutes: v.number(),
      lastSeenAt: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const caller = await resolveCaller(ctx);
    if (caller === null) return null;

    if (caller.user === null) {
      // A real Better Auth account with no staff record. Deliberately not
      // auto-provisioned (see `resolveCaller`), so the client shows "your account
      // is not registered - contact an administrator" rather than a blank app.
      const identity = await ctx.auth.getUserIdentity();
      return { kind: 'no-account' as const, email: identity?.email ?? null };
    }

    const { user } = caller;
    if (user.status !== 'active') return { kind: 'blocked' as const, status: user.status };

    const settings = await loadSettings(ctx);

    const verdict = await sessionVerdict(ctx, caller, settings);
    if (!verdict.live) return { kind: 'session-ended' as const, reason: verdict.reason };

    const actor = await buildActor(ctx, user, caller.authSessionId);
    const compliance = await complianceFor(ctx, user, settings);

    const projection =
      caller.authSessionId === null
        ? null
        : await ctx.db
            .query('userSessions')
            .withIndex('by_authSessionId', (q) =>
              q.eq('authSessionId', caller.authSessionId as string),
            )
            .unique();

    return {
      kind: 'active' as const,
      user: {
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
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      },
      permissions: [...actor.permissions],
      ...compliance,
      // Sent so the client can run its own idle countdown and warn before the
      // server cuts the session off. `lastSeenAt` anchors that countdown to what
      // the server actually recorded rather than to the tab's own clock.
      sessionTimeoutMinutes: settings?.sessionTimeoutMinutes ?? 0,
      lastSeenAt: projection?.lastSeenAt ?? null,
    };
  },
});

/**
 * "I am still here."
 *
 * The write half of the idle timeout. `sessionVerdict` refuses a session whose
 * `lastSeenAt` has gone stale, and only this advances it - so the client calls it
 * on real interaction, throttled to once every few minutes, and an idle tab
 * silently stops. See the long note in `sessionVerdict` for why the token's own
 * lifetime cannot stand in for this.
 *
 * Unaudited on purpose. It fires for every user every few minutes for as long as
 * they are working; audited, it would be the only thing in the trail.
 */
export const touch = authedMutation({
  permission: null,
  audit: { skip: 'Activity heartbeat: no audit value, and its volume would bury the trail.' },
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { authSessionId } = ctx.actor;
    if (authSessionId === null) return null;

    const projection = await ctx.db
      .query('userSessions')
      .withIndex('by_authSessionId', (q) => q.eq('authSessionId', authSessionId))
      .unique();
    if (projection === null || projection.revokedAt !== null) return null;

    await ctx.db.patch(projection._id, { lastSeenAt: new Date(Date.now()).toISOString() });
    return null;
  },
});

/**
 * Re-exported so the client can subscribe to Better Auth's own user record.
 *
 * Used by `AuthBoundary` to notice that the token has stopped resolving, which is
 * how a revoked session becomes a redirect to the sign-in page rather than a
 * screen full of errors.
 */
export const { getAuthUser } = authComponent.clientApi();
