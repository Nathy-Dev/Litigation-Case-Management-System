import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Permission, Role, User } from '@/types';
import { useDataStore } from './dataStore';

/** Any password is accepted in the demo except the one below, which fails. */
export const DEMO_PASSWORD_HINT = 'Any password works in this demo';
const WRONG_PASSWORD = 'wrong';
const DEMO_MFA_CODE = '123456';

export type AuthStep = 'credentials' | 'mfa' | 'authenticated';

interface AuthState {
  currentUserId: string | null;
  step: AuthStep;
  pendingUserId: string | null;
  error: string | null;
  failedAttempts: Record<string, number>;
  lastActivityAt: number;
  signIn: (email: string, password: string) => { ok: boolean; mfaRequired: boolean };
  verifyMfa: (code: string) => boolean;
  signInAs: (userId: string) => void;
  signOut: () => void;
  clearError: () => void;
  touch: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      currentUserId: null,
      step: 'credentials',
      pendingUserId: null,
      error: null,
      failedAttempts: {},
      lastActivityAt: Date.now(),

      signIn: (email, password) => {
        const { users, settings } = useDataStore.getState();
        const user = users.find(
          (item) => item.email.toLowerCase() === email.trim().toLowerCase(),
        );

        if (!user) {
          set({ error: 'No account matches that email address.' });
          return { ok: false, mfaRequired: false };
        }

        if (user.status === 'locked') {
          set({
            error: 'This account is locked after repeated failed sign-in attempts. Contact an administrator.',
          });
          return { ok: false, mfaRequired: false };
        }

        if (user.status === 'disabled') {
          set({ error: 'This account has been disabled.' });
          return { ok: false, mfaRequired: false };
        }

        if (password.trim().toLowerCase() === WRONG_PASSWORD) {
          const attempts = (get().failedAttempts[user.id] ?? 0) + 1;
          const remaining = settings.maxFailedLoginAttempts - attempts;
          set({
            failedAttempts: { ...get().failedAttempts, [user.id]: attempts },
            error:
              remaining > 0
                ? `Incorrect password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before the account is locked.`
                : 'Account locked after 5 failed attempts. Contact an administrator.',
          });

          if (remaining <= 0) {
            useDataStore
              .getState()
              .upsertUser({ ...user, status: 'locked', failedLoginAttempts: attempts }, user.id);
          }
          useDataStore.getState().recordAudit({
            actorId: user.id,
            action: 'Failed sign-in attempt',
            entity: 'Session',
            entityId: `ses_${user.id}`,
            entityLabel: `${user.fullName} — invalid password`,
            outcome: 'failure',
            metadata: { attempt: attempts, threshold: settings.maxFailedLoginAttempts },
          });
          return { ok: false, mfaRequired: false };
        }

        if (user.mfaEnabled) {
          set({ step: 'mfa', pendingUserId: user.id, error: null });
          return { ok: true, mfaRequired: true };
        }

        completeSignIn(set, user);
        return { ok: true, mfaRequired: false };
      },

      verifyMfa: (code) => {
        const pendingId = get().pendingUserId;
        const user = useDataStore.getState().users.find((item) => item.id === pendingId);
        if (!user) return false;

        if (code.trim() !== DEMO_MFA_CODE) {
          set({ error: `Incorrect verification code. Use ${DEMO_MFA_CODE} for this demo.` });
          return false;
        }

        completeSignIn(set, user);
        return true;
      },

      /** Presenter shortcut: jump straight into any role without a password. */
      signInAs: (userId) => {
        const user = useDataStore.getState().users.find((item) => item.id === userId);
        if (!user) return;
        completeSignIn(set, user);
      },

      signOut: () => {
        const userId = get().currentUserId;
        if (userId) {
          useDataStore.getState().recordAudit({
            actorId: userId,
            action: 'Signed out',
            entity: 'Session',
            entityId: `ses_${userId}`,
            entityLabel: 'Session ended',
          });
        }
        set({ currentUserId: null, pendingUserId: null, step: 'credentials', error: null });
      },

      clearError: () => set({ error: null }),
      touch: () => set({ lastActivityAt: Date.now() }),
    }),
    {
      name: 'lcms.auth',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ currentUserId: state.currentUserId, step: state.step }) as AuthState,
    },
  ),
);

function completeSignIn(set: (partial: Partial<AuthState>) => void, user: User) {
  set({
    currentUserId: user.id,
    pendingUserId: null,
    step: 'authenticated',
    error: null,
    lastActivityAt: Date.now(),
  });
  useDataStore.getState().recordAudit({
    actorId: user.id,
    action: 'Signed in',
    entity: 'Session',
    entityId: `ses_${user.id}`,
    entityLabel: `${user.fullName} — ${user.mfaEnabled ? 'password + authenticator' : 'password'}`,
    metadata: { mfa: user.mfaEnabled, role: user.role },
  });
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function useCurrentUser(): User | null {
  const id = useAuthStore((state) => state.currentUserId);
  return useDataStore((state) => state.users.find((user) => user.id === id) ?? null);
}

/**
 * Permission check. Always reads the live matrix from the data store so the
 * runtime edits made in Admin → Roles take effect immediately.
 */
export function usePermission(): (permission: Permission) => boolean {
  const role = useCurrentUser()?.role ?? null;
  const matrix = useDataStore((state) => state.permissionMatrix);
  return (permission: Permission) =>
    Boolean(role && (matrix[role] ?? []).includes(permission));
}

export function useCan(permission: Permission): boolean {
  return usePermission()(permission);
}

export function useRole(): Role | null {
  return useCurrentUser()?.role ?? null;
}
