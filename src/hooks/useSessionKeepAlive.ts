import { useEffect, useRef } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';

/**
 * HYPREP LCMS - session keep-alive.
 *
 * The server enforces the idle timeout (see `sessionVerdict` in convex/lib),
 * but it only knows a user is present if somebody tells it. This hook advances
 * the user's `lastSeenAt` so an active session never dies mid-sentence.
 *
 * Only real interaction refreshes the idle clock. Leaving a browser tab open
 * must not keep a sensitive legal session alive indefinitely.
 *
 * It has to live *inside* the authenticated tree (AppShell), because the query
 * it calls is an authenticated mutation that would throw for a signed-out tab.
 */
export function useSessionKeepAlive(touchIntervalMs = 60_000) {
  const touch = useMutation(api.auth.touch);
  const last = useRef(0);

  useEffect(() => {
    const ping = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - last.current >= touchIntervalMs) {
        last.current = now;
        void touch().catch(() => {});
      }
    };
    const options = { passive: true, capture: true } as const;
    window.addEventListener('pointermove', ping, options);
    window.addEventListener('keydown', ping, options);
    window.addEventListener('pointerdown', ping, options);
    window.addEventListener('scroll', ping, options);
    return () => {
      window.removeEventListener('pointermove', ping, options);
      window.removeEventListener('keydown', ping, options);
      window.removeEventListener('pointerdown', ping, options);
      window.removeEventListener('scroll', ping, options);
    };
  }, [touch, touchIntervalMs]);
}
