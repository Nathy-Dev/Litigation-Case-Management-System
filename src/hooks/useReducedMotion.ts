import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the viewer has asked their system for less motion.
 *
 * The stylesheet already flattens CSS transitions for this preference, but the
 * charts animate SVG attributes from JavaScript, which no stylesheet can reach.
 * They ask here instead, so a bar chart paints its final state outright rather
 * than growing out of the axis (WCAG 2.1 AA, TOR §33).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setReduced(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
