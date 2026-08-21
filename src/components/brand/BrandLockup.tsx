import { Link } from 'react-router-dom';
import { CoatOfArms } from './CoatOfArms';
import { cn } from '@/lib/utils';

interface BrandLockupProps {
  /** `compact` shows the coat of arms only — used by the collapsed sidebar. */
  compact?: boolean;
  /** `light` inverts the type for use on the dark green sidebar. */
  tone?: 'light' | 'dark';
  to?: string;
  className?: string;
}

/**
 * The application lockup: coat of arms + organisation name + unit name.
 * Rendered as a link so it doubles as the "home" affordance.
 */
export function BrandLockup({ compact = false, tone = 'dark', to = '/', className }: BrandLockupProps) {
  const light = tone === 'light';

  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-2.5 rounded-lg outline-offset-4 transition-opacity hover:opacity-90',
        className,
      )}
      aria-label="HYPREP Litigation & Case Management System — home"
    >
      {/* A white plate keeps the black shield and white supporters legible on green. */}
      <span
        className={cn(
          'grid shrink-0 place-items-center overflow-hidden rounded-lg bg-white p-1',
          light ? 'ring-1 ring-white/25' : 'ring-1 ring-ink-200/70',
          compact ? 'size-9' : 'size-11',
        )}
      >
        <CoatOfArms size={compact ? 20 : 24} decorative />
      </span>

      {!compact && (
        <span className="min-w-0">
          <span
            className={cn(
              'block truncate font-serif text-[15px] leading-tight font-semibold',
              light ? 'text-white' : 'text-ink-900',
            )}
          >
            HYPREP
          </span>
          <span
            className={cn(
              'block truncate text-[11px] leading-tight tracking-wide uppercase',
              light ? 'text-brand-100' : 'text-ink-500',
            )}
          >
            Legal Unit · LCMS
          </span>
        </span>
      )}
    </Link>
  );
}
