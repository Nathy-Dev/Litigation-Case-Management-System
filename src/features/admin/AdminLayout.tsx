import { NavLink, Outlet } from 'react-router-dom';
import { ClipboardList, Server, ShieldCheck, SlidersHorizontal, Users } from 'lucide-react';
import type { Permission } from '@/types';
import { cn } from '@/lib/utils';
import { usePermission } from '@/store/authStore';
import { PageHeader } from '@/components/layout/PageHeader';

const SECTIONS: { to: string; label: string; hint: string; icon: typeof Users; needs: Permission[] }[] = [
  {
    to: '/admin/users',
    label: 'Users & teams',
    hint: 'Accounts, roles, invitations and bulk import',
    icon: Users,
    needs: ['user.view', 'user.manage'],
  },
  {
    to: '/admin/roles',
    label: 'Roles & permissions',
    hint: 'The permission matrix applied across the system',
    icon: ShieldCheck,
    needs: ['role.manage'],
  },
  {
    to: '/admin/configuration',
    label: 'Configuration',
    hint: 'Case types, courts, document types, tags and status flow',
    icon: SlidersHorizontal,
    needs: ['config.manage'],
  },
  {
    to: '/admin/audit',
    label: 'Audit trail',
    hint: 'Every action with the user, time and IP address',
    icon: ClipboardList,
    needs: ['audit.view'],
  },
  {
    to: '/admin/system',
    label: 'System & storage',
    hint: 'Sessions, retention, storage quota and backups',
    icon: Server,
    needs: ['system.manage', 'retention.manage'],
  },
];

/** Administration shell (TOR §27–35). Sections appear only where permitted. */
export function AdminLayout() {
  const can = usePermission();
  const allowed = SECTIONS.filter((section) => section.needs.some((permission) => can(permission)));

  return (
    <div>
      <PageHeader
        title="Administration"
        hint="Configuration is applied immediately across the system — every change is written to the audit trail."
      />

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Administration sections" className="rounded-xl border border-ink-200 bg-white p-1.5">
          <ul className="space-y-0.5">
            {allowed.map((section) => (
              <li key={section.to}>
                <NavLink
                  to={section.to}
                  className={({ isActive }) =>
                    cn(
                      'flex gap-2.5 rounded-lg px-2.5 py-2 transition-colors',
                      isActive ? 'bg-brand-50 text-brand-900' : 'text-ink-700 hover:bg-ink-50',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <section.icon
                        className={cn(
                          'mt-0.5 size-4 shrink-0',
                          isActive ? 'text-brand-600' : 'text-ink-400',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold">{section.label}</span>
                        {/* The one-line explanation belongs to the section you are
                            actually in; on the others it is just noise. */}
                        {isActive && (
                          <span className="mt-0.5 block text-[11px] text-brand-700/80">
                            {section.hint}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
