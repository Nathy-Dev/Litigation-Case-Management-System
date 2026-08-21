import type { ReactNode } from 'react';
import type { User } from '@/types';
import { cn } from '@/lib/utils';

interface AvatarProps {
  user?: Pick<User, 'initials' | 'fullName' | 'avatarColor'> | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Shows a ring — used for the signed-in user in the top bar. */
  ring?: boolean;
}

/**
 * `user.avatarColor` carries a palette *name* ("brand", "teal"), not a CSS
 * colour, so it has to be looked up — handing it straight to `background-color`
 * silently painted nothing for every name CSS does not happen to recognise.
 * Each value is dark enough to carry white initials at AA contrast.
 */
const AVATAR_TINTS: Record<string, string> = {
  brand: '#007546',
  info: '#2358ad',
  gold: '#a56d0b',
  purple: '#6b4d91',
  teal: '#0d7683',
  ink: '#586666',
  danger: '#b62f21',
};

const SIZES = {
  xs: 'size-6 text-[10px]',
  sm: 'size-7 text-[11px]',
  md: 'size-9 text-xs',
  lg: 'size-11 text-sm',
  xl: 'size-16 text-lg',
} as const;

export function Avatar({ user, size = 'md', className, ring }: AvatarProps) {
  if (!user) {
    return (
      <span
        className={cn('grid shrink-0 place-items-center rounded-full bg-ink-200', SIZES[size], className)}
        aria-hidden
      />
    );
  }

  return (
    <span
      title={user.fullName}
      style={{ backgroundColor: AVATAR_TINTS[user.avatarColor] ?? AVATAR_TINTS.brand }}
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold text-white select-none',
        SIZES[size],
        ring && 'ring-2 ring-white/70',
        className,
      )}
    >
      {user.initials}
    </span>
  );
}

interface AvatarGroupProps {
  users: Array<Pick<User, 'id' | 'initials' | 'fullName' | 'avatarColor'>>;
  max?: number;
  size?: 'xs' | 'sm' | 'md';
}

export function AvatarGroup({ users, max = 3, size = 'sm' }: AvatarGroupProps) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;

  return (
    <span className="flex items-center">
      {shown.map((user) => (
        <Avatar
          key={user.id}
          user={user}
          size={size}
          className="-ml-1.5 ring-2 ring-white first:ml-0"
        />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            '-ml-1.5 grid place-items-center rounded-full bg-ink-100 font-semibold text-ink-600 ring-2 ring-white',
            SIZES[size],
          )}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

/** Name + role stacked next to an avatar — used in tables and lists. */
export function UserCell({
  user,
  secondary,
  size = 'sm',
}: {
  user?: User | null;
  secondary?: ReactNode;
  size?: 'xs' | 'sm' | 'md';
}) {
  if (!user) return <span className="text-ink-400">—</span>;

  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar user={user} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ink-800">{user.fullName}</span>
        <span className="block truncate text-[11px] text-ink-500">{secondary ?? user.title}</span>
      </span>
    </span>
  );
}
