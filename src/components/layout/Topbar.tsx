import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Menu, Search, Settings, User as UserIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/permissions';
import { useAuthStore, useCurrentUser } from '@/store/authStore';
import { useDataStore } from '@/store/dataStore';
import { useUiStore } from '@/store/uiStore';
import { Avatar } from '@/components/ui/Avatar';
import { Dropdown, MenuItem, MenuSeparator } from '@/components/ui/Dropdown';

function SearchTrigger() {
  const open = useUiStore((state) => state.setCommandPalette);
  return (
    <button
      type="button"
      onClick={() => open(true)}
      className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-ink-100/80 px-3 text-[13px] text-ink-500 ring-1 ring-transparent transition-all hover:bg-ink-100 hover:ring-ink-200 md:max-w-md"
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left">Search matters, documents, people…</span>
      <kbd className="hidden rounded border border-ink-250 bg-white px-1.5 py-0.5 text-[10px] font-medium text-ink-500 sm:block">
        Ctrl K
      </kbd>
    </button>
  );
}

function NotificationsBell() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const notifications = useDataStore((state) => state.notifications);
  const markRead = useDataStore((state) => state.markNotificationRead);
  const markAll = useDataStore((state) => state.markAllNotificationsRead);

  const mine = user ? notifications.filter((n) => n.userId === user.id) : [];
  const unread = mine.filter((n) => !n.read).length;

  return (
    <Dropdown
      width="w-[22rem]"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
          aria-expanded={open}
          className={cn(
            'relative grid size-9 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800',
            open && 'bg-ink-100 text-ink-800',
          )}
        >
          <Bell className="size-4.5" aria-hidden />
          {unread > 0 && (
            <span className="tnum absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-danger-500 px-1 text-[10px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
            <p className="text-[13px] font-semibold text-ink-900">Notifications</p>
            {unread > 0 && user && (
              <button
                type="button"
                onClick={() => markAll(user.id)}
                className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-brand-700 hover:text-brand-800"
              >
                <CheckCheck className="size-3" aria-hidden />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {mine.slice(0, 8).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  markRead(item.id);
                  close();
                  if (item.link) navigate(item.link);
                }}
                className={cn(
                  'flex w-full gap-2.5 border-b border-ink-100/70 px-3 py-2.5 text-left transition-colors hover:bg-ink-50',
                  !item.read && 'bg-brand-50/50',
                )}
              >
                <span
                  className={cn(
                    'mt-1.5 size-1.5 shrink-0 rounded-full',
                    item.read ? 'bg-transparent' : 'bg-brand-500',
                  )}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink-900">{item.title}</span>
                  <span className="mt-0.5 block line-clamp-2 text-[12px] leading-snug text-ink-500">
                    {item.body}
                  </span>
                  <span className="mt-1 block text-[11px] text-ink-400">{formatRelative(item.at)}</span>
                </span>
              </button>
            ))}
            {mine.length === 0 && (
              <p className="px-3 py-6 text-center text-[13px] text-ink-500">Nothing to catch up on.</p>
            )}
          </div>

          <Link
            to="/notifications"
            onClick={close}
            className="block px-3 py-2 text-center text-[12px] font-medium text-brand-700 hover:bg-ink-50"
          >
            View all notifications
          </Link>
        </>
      )}
    </Dropdown>
  );
}

function UserMenu() {
  const user = useCurrentUser();
  const signOut = useAuthStore((state) => state.signOut);
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <Dropdown
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label="Account menu"
          className={cn('rounded-full ring-offset-2 transition-shadow', open && 'ring-2 ring-brand-400')}
        >
          <Avatar user={user} size="sm" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="border-b border-ink-100 px-3 py-2.5">
            <p className="truncate text-[13px] font-semibold text-ink-900">{user.fullName}</p>
            <p className="truncate text-[12px] text-ink-500">{user.email}</p>
            <p className="mt-1 text-[11px] font-medium text-brand-700">{ROLE_LABELS[user.role]}</p>
          </div>
          <MenuItem
            icon={<UserIcon className="size-4" aria-hidden />}
            onClick={() => {
              close();
              navigate('/profile');
            }}
          >
            My profile
          </MenuItem>
          <MenuItem
            icon={<Settings className="size-4" aria-hidden />}
            onClick={() => {
              close();
              navigate('/profile?tab=preferences');
            }}
          >
            Preferences
          </MenuItem>
          <MenuSeparator />
          <MenuItem destructive onClick={signOut}>
            Sign out
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}

export function Topbar() {
  const setMobileNav = useUiStore((state) => state.setMobileNav);

  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-ink-200 bg-white/95 px-3 backdrop-blur sm:gap-3 sm:px-5">
      <button
        type="button"
        onClick={() => setMobileNav(true)}
        aria-label="Open navigation"
        className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-600 transition-colors hover:bg-ink-100 lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <SearchTrigger />

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <NotificationsBell />
        <UserMenu />
      </div>
    </header>
  );
}
