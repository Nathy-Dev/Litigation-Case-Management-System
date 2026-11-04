import { defineApp } from 'convex/server';
import betterAuth from '@convex-dev/better-auth/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';

/**
 * Convex component registration.
 *
 * Components get their own isolated table namespace inside this deployment, so
 * nothing here is a third-party service holding HYPREP data - it is all running
 * in the project's own Convex instance.
 *
 * - `betterAuth`  owns the credential store: user/session/account/twoFactor.
 *                 The domain `users` table in `schema.ts` is separate and links
 *                 to it by `authUserId`.
 * - `rateLimiter` backs per-API-key throttling on the public REST surface
 *                 (`http.ts`), so one integration cannot exhaust the deployment.
 */
const app = defineApp();

app.use(betterAuth);
app.use(rateLimiter);

export default app;
