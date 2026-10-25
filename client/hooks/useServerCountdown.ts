import { useEffect, useState } from 'react';

/**
 * Clients render a smooth countdown, but all scoring and round transitions use
 * the server's endsAt timestamp. The serverNow offset limits clock drift.
 */
export function useServerCountdown(
  endsAt: number | null,
  serverNow: number,
): { remainingMs: number; seconds: number } {
  const [remainingMs, setRemainingMs] = useState(() => (endsAt ? Math.max(0, endsAt - Date.now()) : 0));

  useEffect(() => {
    const offset = serverNow - Date.now();
    const update = () => {
      setRemainingMs(endsAt ? Math.max(0, endsAt - (Date.now() + offset)) : 0);
    };
    update();
    if (!endsAt) return;
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [endsAt, serverNow]);

  return { remainingMs, seconds: Math.ceil(remainingMs / 1000) };
}
