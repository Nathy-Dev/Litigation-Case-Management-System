import { cn } from '@/lib/utils';

/**
 * The official Coat of Arms of the Federal Republic of Nigeria, served from
 * `public/coat-of-arms.svg` so it is fetched once and cached rather than being
 * bundled into every chunk that renders the brand.
 *
 * The artwork is wider than it is tall (398 × 338), so `size` sets the *height*
 * and the width follows the aspect ratio.
 */
export function CoatOfArms({
  size = 32,
  className,
  title = 'Coat of Arms of the Federal Republic of Nigeria',
  decorative = false,
}: {
  size?: number;
  className?: string;
  title?: string;
  /** Set when the mark sits beside text that already names the organisation. */
  decorative?: boolean;
}) {
  return (
    <img
      src="/coat-of-arms.svg"
      width={Math.round(size * 1.1796)}
      height={size}
      alt={decorative ? '' : title}
      aria-hidden={decorative || undefined}
      className={cn('block h-auto max-w-none object-contain select-none', className)}
      style={{ height: size }}
      draggable={false}
    />
  );
}
