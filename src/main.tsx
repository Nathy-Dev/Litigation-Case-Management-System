import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConvexReactClient } from 'convex/react';
import { ConvexBetterAuthProvider, type AuthClient as ProviderAuthClient } from '@convex-dev/better-auth/react';
import './index.css';
import { App } from './App';
import { authClient } from './authClient';

/**
 * The WebSocket client for the Convex deployment, wired to Better Auth.
 *
 * `VITE_CONVEX_URL` is the deployment's WebSocket URL; `authClient` (in
 * `authClient.ts`) knows how to turn the session cookie into the JWT this
 * client presents, so `ctx.auth.getUserIdentity()` resolves in every query and
 * mutation and the whole auth boundary is enforced server-side.
 */
const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexBetterAuthProvider
      client={convex}
      // The `better-auth` and `@convex-dev/better-auth` packages are a version
      // apart on the `useSession().data` shape (Date vs string), but the token
      // fetch these plugins perform is wire-compatible. Bridge the declared
      // type; the runtime API is what the provider actually consumes.
      authClient={authClient as unknown as ProviderAuthClient}
    >
      <App />
    </ConvexBetterAuthProvider>
  </StrictMode>,
);
