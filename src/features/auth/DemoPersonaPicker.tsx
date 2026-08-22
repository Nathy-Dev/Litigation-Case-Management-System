import { ChevronRight, Users } from 'lucide-react';
import { ROLES, type Role } from '@/types';
import { ROLE_LABELS, ROLE_SUMMARIES } from '@/lib/permissions';
import { useDataStore } from '@/store/dataStore';
import { useAuthStore } from '@/store/authStore';
import { Avatar } from '@/components/ui/Avatar';

/**
 * Review aid, not a product feature: one click into each of the six user
 * classes described in the terms of reference so a reviewer can compare the
 * role-based dashboards without juggling passwords.
 */
export function DemoPersonaPicker({ onPicked }: { onPicked: () => void }) {
  const users = useDataStore((state) => state.users);
  const signInAs = useAuthStore((state) => state.signInAs);

  const personas = ROLES.map((role: Role) => users.find((u) => u.role === role && u.status === 'active'))
    .filter((u): u is NonNullable<typeof u> => Boolean(u));

  return (
    <section className="mt-8 rounded-card border border-dashed border-gold-300 bg-gold-50/70 p-4">
      <header className="flex items-center gap-2">
        <Users className="size-4 text-gold-700" aria-hidden />
        <h3 className="text-[13px] font-semibold text-gold-900">Review shortcuts</h3>
      </header>
      <p className="mt-1 text-[12px] leading-snug text-gold-800/90">
        Sign in directly as each user class to see what that role can reach.
      </p>

      <ul className="mt-3 divide-y divide-gold-200/70">
        {personas.map((user) => (
          <li key={user.id}>
            <button
              type="button"
              onClick={() => {
                signInAs(user.id);
                onPicked();
              }}
              className="group flex w-full items-center gap-2.5 py-2 text-left"
            >
              <Avatar user={user} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink-900">
                  {ROLE_LABELS[user.role]}
                </span>
                <span className="block truncate text-[11px] text-ink-500">
                  {user.fullName} · {ROLE_SUMMARIES[user.role]}
                </span>
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-gold-600 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-gold-200/70 pt-2.5 text-[11px] leading-snug text-gold-800/80">
        To try the security behaviour: sign in with password <code className="font-mono">wrong</code> to
        walk an account towards lockout, use <code className="font-mono">p.ekanem@hyprep.gov.ng</code> for
        an already-locked account, and <code className="font-mono">c.okonkwo@hyprep.gov.ng</code> for a
        multi-factor account (code <code className="font-mono">123456</code>).
      </p>
    </section>
  );
}
