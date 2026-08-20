import { NavLink, useLocation } from 'react-router-dom';
import { ChevronLeft, LogOut, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore, useCurrentUser, usePermission } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { useDataStore } from '@/store/dataStore';
import { ROLE_LABELS } from '@/lib/permissions';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { Avatar } from '@/components/ui/Avatar';
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from './nav';

function useVisibleNav(items: NavItem[]) {
  const can = usePermission();
  return items.filter((item) => !item.permissions || item.permissions.some((p) => can(p)));
}

function NavRow({ item, collapsed, badge }: { item: NavItem; collapsed: boolean; badge?: number }) {
  const location = useLocation();
  const isActive = item.match
    ? location.pathname === item.match || location.pathname.startsWith(`${item.match}/`)
    : location.pathname === item.to;

  return (
    <NavLink
      to={item.to}
      end={!item.match}
      title={collapsed ? item.label : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        collapsed && 'justify-center px-0',
        isActive
          ? 'bg-white/12 text-white'
          : 'text-brand-100/85 hover:bg-white/8 hover:text-white',
      )}
    >
      {isActive && (
        <span className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r bg-gold-400" aria-hidden />
      )}
      <item.icon className="size-4.5 shrink-0" aria-hidden />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {!collapsed && badge != null && badge > 0 && (
        <span className="tnum rounded-full bg-gold-400 px-1.5 py-0.5 text-[11px] font-bold text-ink-900">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {collapsed && badge != null && badge > 0 && (
        <span className="absolute top-1 right-1 size-1.5 rounded-full bg-gold-400" aria-hidden />
      )}
    </NavLink>
  );
}

export function SidebarContent({ collapsed = false }: { collapsed?: boolean }) {
  const user = useCurrentUser();
  const signOut = useAuthStore((state) => state.signOut);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const unread = useDataStore((state) =>
    user ? state.notifications.filter((n) => n.userId === user.id && !n.read).length : 0,
  );

  const primary = useVisibleNav(PRIMARY_NAV);
  const secondary = useVisibleNav(SECONDARY_NAV);

  return (
    <div className="flex h-full flex-col bg-brand-800 text-white">
      <div className={cn('flex items-center gap-2 px-4 py-4', collapsed && 'justify-center px-0')}>
        <BrandLockup tone="light" compact={collapsed} />
      </div>

      <nav aria-label="Main" className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-2.5 pb-2">
        {primary.map((item) => (
          <NavRow key={item.to} item={item} collapsed={collapsed} />
        ))}

        <hr className="mx-1 my-3 border-white/12" />

        {secondary.map((item) => (
          <NavRow key={item.to} item={item} collapsed={collapsed} badge={unread} />
        ))}
      </nav>

      <div className="border-t border-white/12 p-2.5">
        {user && (
          <NavLink
            to="/profile"
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-white/8',
              collapsed && 'justify-center px-0',
            )}
          >
            <Avatar user={user} size="sm" />
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-white">{user.fullName}</span>
                <span className="block truncate text-[11px] text-brand-100/70">
                  {ROLE_LABELS[user.role]}
                </span>
              </span>
            )}
          </NavLink>
        )}

        <div className={cn('mt-1 flex items-center gap-1', collapsed && 'flex-col')}>
          <button
            type="button"
            onClick={signOut}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-[12px] font-medium text-brand-100/80 transition-colors hover:bg-white/8 hover:text-white"
          >
            <LogOut className="size-3.5" aria-hidden />
            {!collapsed && 'Sign out'}
          </button>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden rounded-lg p-1.5 text-brand-100/70 transition-colors hover:bg-white/8 hover:text-white lg:block"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden />
            ) : (
              <ChevronLeft className="size-4" aria-hidden />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
