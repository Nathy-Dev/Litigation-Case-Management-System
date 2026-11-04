import { createAuthClient } from 'better-auth/react';
import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins';
import { twoFactorClient } from 'better-auth/client/plugins';

/**
 * HYPREP LCMS - the Better Auth client.
 *
 * One client for every sign-in, MFA and session call. It talks to the Better
 * Auth component running inside this Convex deployment (its HTTP surface is
 * mounted at `/api/auth` on the site URL - see `convex/http.ts`).
 *
 * Three plugins do the security-critical work:
 *
 * - `crossDomainClient` makes the session cookie usable even though the app is
 *   served from `SITE_URL` while Convex's auth endpoints live on the deployment
 *   site URL - two different origins. It is what makes a cross-origin sign-in
 *   actually take effect.
 * - `convexClient` teaches this client how to mint the JWT that
 *   `ConvexBetterAuthProvider` hands to `convex.setAuth(...)`, so the
 *   domain queries in `convex/*` see `ctx.auth.getUserIdentity()` resolve.
 * - `twoFactorClient` exposes the TOTP enrolment and verification endpoints so
 *   the MFA screens (sign-in and the compliance gate) can talk to them.
 *
 * `VITE_CONVEX_SITE_URL` is the deployment's site URL (the `CONVEX_SITE_URL`,
 * distinct from the WebSocket `VITE_CONVEX_URL`).
 */
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_CONVEX_SITE_URL as string,
  plugins: [crossDomainClient(), convexClient(), twoFactorClient()],
});

export type AuthClient = typeof authClient;