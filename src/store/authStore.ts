import { useCallback } from 'react';
import { create } from 'zustand';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Permission, Role, User } from '@/types';
import { authClient } from '@/authClient';

/**
 * HYPREP LCMS - the auth seam, backed by Convex.
 *
 * This file keeps its path and its exported names so that every import site in
 * the UI is untouched, but its guts are gone. The prototype resolved identity,
 * permissions and the audit trail on the client from a demo store; each of
 * those is now a server decision made in `convex/` and read reactively here.
 *
 * The four selectors below are one subscription apiece to `api.auth.me`, which
 * resolves the caller, their role, their live permission set and their security
 * compliance from the `permissionMatrix` and `settings` tables on every read.
 * That is how a runtime edit to a role, a disabled account or a revoked
 * session reaches every open tab within a round trip.
 *
 * `useAuthStore` is kept as a sliver of UI-only state (`signOut`) for the few
 * call sites that still hold a store reference; there is no credential or
 * session data here, because Better Auth owns it.
 */

type Me = NonNullable<Awaited<ReturnType<typeof useMe>>>;

/** One subscription shared by every selector below. */
function useMe() {
  return useQuery(api.auth.me);
}

/** Whether the resolved `me` is a signed-in, active caller. `null`/`undefined` are false. */
function isActiveMe(me: Me | null | undefined): me is Extract<Me, { kind: 'active' }> {
  return me != null && me.kind === 'active';
}

function toUser(me: Extract<Me, { kind: 'active' }>): User {
  const u = me.user;
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    // The domain record stores these as strings; the server guarantees the
    // values are a valid title, so the narrow type is restored at the seam.
    phone: u.phone ?? '',
    title: u.title as User['title'],
    role: u.role as Role,
    department: u.department,
    teamId: u.teamId,
    practisingLicenceNo: u.practisingLicenceNo,
    firm: u.firm,
    avatarColor: u.avatarColor,
    initials: u.initials,
    status: u.status,
    mfaEnabled: u.mfaEnabled,
    // `me` does not ship the lockout counter (nothing the UI does needs it);
    // the prototype's `User` type carried it, so default it for the contract.
    failedLoginAttempts: 0,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

/**
 * The signed-in, active caller, or `null`.
 *
 * `null` covers both "not signed in" and "still resolving from the server", so
 * consumers keep working, but the authenticated tree is gated by
 * `RequireSession`/`RequireAuth` in `app/guards.tsx` so that downstream code
 * never renders against that `null` and then flashes when it arrives.
 */
export function useCurrentUser(): User | null {
  const me = useMe();
  if (isActiveMe(me)) return toUser(me);
  return null;
}

/**
 * Permission check. Always reads the live matrix via `api.auth.me`, so runtime
 * edits made in Admin → Roles take effect on the next round trip.
 */
export function usePermission(): (permission: Permission) => boolean {
  const me = useMe();
  return useCallback(
    (permission: Permission) => (isActiveMe(me) ? me.permissions.includes(permission) : false),
    [me],
  );
}

export function useCan(permission: Permission): boolean {
  return usePermission()(permission);
}

export function useRole(): Role | null {
  const me = useMe();
  if (isActiveMe(me)) return me.user.role as Role;
  return null;
}

/**
 * Whether the signed-in caller is behind on a security obligation.
 *
 * Reads from `me`, which carries the same verdict the server enforces before
 * every mutation, so the UI routes for it and the server refuses it in step.
 */
export function useCompliance() {
  const me = useMe();
  if (!isActiveMe(me)) {
    return { mustEnrolMfa: false, mustChangePassword: false };
  }
  return { mustEnrolMfa: me.mustEnrolMfa, mustChangePassword: me.mustChangePassword };
}

/** The richer denied/special states `me` can report, so screens can explain them. */
export type MeKind = Me['kind'];

export type AuthStateKind = MeKind | 'loading' | 'signed-out';

export function useAuthState(): {
  kind: AuthStateKind;
  email: string | null;
  reason: string | null;
} {
  const me = useMe();
  if (me === undefined) return { kind: 'loading', email: null, reason: null };
  if (me === null) return { kind: 'signed-out', email: null, reason: null };
  if (me.kind === 'active') return { kind: 'active', email: me.user.email, reason: null };
  if (me.kind === 'no-account') return { kind: 'no-account', email: me.email, reason: null };
  if (me.kind === 'blocked') return { kind: 'blocked', email: null, reason: me.status };
  return { kind: 'session-ended', email: null, reason: me.reason };
}

// ---------------------------------------------------------------------------
// UI-only store
// ---------------------------------------------------------------------------

/**
 * A deliberately thin store. The only surviving caller of the old raw store is
 * `signOut`, and the only honest way to end a session is to let Better Auth end
 * it - the server-side tables, not a local flag, are the source of truth.
 */
export const useAuthStore = create<{
  signOut: () => Promise<void>;
}>((set) => ({
  signOut: async () => {
    await authClient.signOut();
    set({});
  },
}));

export type AuthStep = 'credentials' | 'mfa' | 'authenticated';