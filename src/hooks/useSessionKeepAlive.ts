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
 * **Why a timer, not just events.** The prototype advanced `lastSeenAt` only on
 * pointer/key/focus events. That is enough for a form-heavy app but wrong for
 * this one: reading a judgment, watching a dashboard chart or reviewing a
 * document produces no pointer or key events, so an idle timer that depends on
 * them signs the user out while they are actively reading. The touch now runs
 * on a short interval (`touchIntervalMs`) regardless of input, so a session is
 * kept alive by *being on the page* - which is the honest definition of active
 * for a system whose primary activity is reading documents.
 *
 * It has to live *inside* the authenticated tree (AppShell), because the query
 * it calls is an authenticated mutation that would throw for a signed-out tab.
 */
export function useSessionKeepAlive(touchIntervalMs = 60_000) {
  const touch = useMutation(api.auth.touch);
  const last = useRef(0);

  useEffect(() => {
    const ping = () => {
      const now = Date.now();
      if (now - last.current >= touchIntervalMs) {
        last.current = now;
        void touch();
      }
    };
    const options = { passive: true, capture: true } as const;
    // Real interaction advances the clock immediately (throttled); the interval
    // catches the reading-only case where no interaction occurs.
    window.addEventListener('pointermove', ping, options);
    window.addEventListener('keydown', ping, options);
    window.addEventListener('visibilitychange', ping, options);
    const timer = window.setInterval(ping, Math.min(touchIntervalMs, 60_000));
    return () => {
      window.removeEventListener('pointermove', ping, options);
      window.removeEventListener('keydown', ping, options);
      window.removeEventListener('visibilitychange', ping, options);
      window.clearInterval(timer);
    };
  }, [touch, touchIntervalMs]);
}
