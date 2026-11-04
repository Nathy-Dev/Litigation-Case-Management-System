import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config';
import type { AuthConfig } from 'convex/server';

/**
 * HYPREP LCMS - which token issuer this deployment trusts.
 *
 * Better Auth runs inside this deployment and mints a short-lived JWT for each
 * session; this file is what makes Convex accept it, by pointing at the JWKS
 * endpoint the `convex` plugin publishes on the deployment's own site URL.
 *
 * Worth knowing because the failure mode is silent: if this file is missing or
 * names the wrong issuer, nothing errors - `ctx.auth.getUserIdentity()` simply
 * returns `null` forever and the app is permanently signed out, with a
 * successful sign-in request in the network log to contradict it.
 */
export default { providers: [getAuthConfigProvider()] } satisfies AuthConfig;
