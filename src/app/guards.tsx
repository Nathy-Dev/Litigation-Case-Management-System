import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useConvexAuth } from 'convex/react';
import type { Permission } from '@/types';
import { useAuthState, useCompliance, usePermission } from '@/store/authStore';
import { EmptyState } from '@/components/ui/EmptyState';
import { ButtonLink } from '@/components/ui/Button';
import { ComplianceGate } from '@/features/auth/ComplianceGate';

/**
 * HYPREP LCMS - route guards.
 *
 * In the prototype these read a client-side store, so they were decoration:
 * a hidden button, but nothing stopped a crafted call. Every guard here reads
 * `api.auth.me`, which resolves the caller from the server - so what a route
 * allows is what the server would allow, in step with the enforcement that
 * `lib/functions.ts` applies to every mutation.
 */

/** Centered, lightweight "resolving session" placeholder used while `me` loads. */
export function AuthLoading() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-3">
        <span className="size-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />
        <p className="text-[13px] text-ink-500">Checking your session…</p>
      </div>
    </div>
  );
}

/**
 * Convex can briefly be between two auth states while it replaces an expired
 * access token. During that window `api.auth.me` may be null or unresolved even
 * though the user was authenticated moments ago. Keep the route mounted until
 * Convex has finished that transition; otherwise a normal token refresh looks
 * like a sign-out and the router sends the user back to the login screen.
 */
function useAuthTransition() {
  const convexAuth = useConvexAuth();
  const { kind } = useAuthState();
  const waitingForResolution =
    convexAuth.isLoading ||
    convexAuth.isRefreshing ||
    kind === 'loading' ||
    // Convex has a valid identity, but the domain `me` query has not caught up.
    // Wait for its result instead of treating this short gap as signed out.
    (convexAuth.isAuthenticated && kind === 'signed-out');

  return { ...convexAuth, kind, waitingForResolution };
}

/**
 * Holds render until `me` has resolved, so the authenticated tree never
 * renders against an in-flight identity and flashes an empty state.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { waitingForResolution } = useAuthTransition();
  if (waitingForResolution) return <AuthLoading />;
  return <>{children}</>;
}

/**
 * Bounces anyone who is not a signed-in, active caller to the sign-in screen,
 * keeping their target so the sign-in screen can send them back.
 *
 * The three "signed in but not usable" states - no staff record, blocked, or
 * session ended - are also routed here; `SignInPage` reads `me` and explains
 * whichever one applies rather than showing a bare form.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { kind, waitingForResolution, isAuthenticated } = useAuthTransition();
  const location = useLocation();

  if (waitingForResolution) return <AuthLoading />;
  if (!isAuthenticated || kind !== 'active') {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/**
 * Refuses the authenticated tree for a caller who owes a security obligation
 * the TOR imposes - MFA enrolment or a password change - and shows the screen
 * that clears it.
 *
 * This is UX; the same conditions are enforced in `lib/functions.ts` before
 * every mutation, so the text and the server cannot drift into disagreement.
 */
export function RequireCompliance({ children }: { children: ReactNode }) {
  const { mustEnrolMfa, mustChangePassword } = useCompliance();
  if (mustEnrolMfa || mustChangePassword) {
    return <ComplianceGate mustEnrolMfa={mustEnrolMfa} mustChangePassword={mustChangePassword} />;
  }
  return <>{children}</>;
}

/**
 * Route-level permission gate. Any one of `anyOf` is enough — the register, for
 * example, opens for both `case.view.all` and `case.view.assigned`. The grants
 * are resolved server-side through `api.auth.me`, and invalidate reactively
 * when the matrix is edited.
 */
export function RequirePermission({ anyOf, children }: { anyOf: Permission[]; children: ReactNode }) {
  const can = usePermission();
  if (anyOf.some((permission) => can(permission))) return <>{children}</>;

  return (
    <EmptyState
      as="h1"
      icon={<ShieldAlert className="size-6" aria-hidden />}
      title="You do not have access to this area"
      description="Your role does not include the permissions needed for this page. Ask a system administrator if you believe this is wrong."
      action={<ButtonLink to="/" variant="primary">Back to dashboard</ButtonLink>}
    />
  );
}
