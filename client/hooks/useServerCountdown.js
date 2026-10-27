import { useEffect, useState } from "react";
function useServerCountdown(endsAt, serverNow) {
  const [remainingMs, setRemainingMs] = useState(() => endsAt ? Math.max(0, endsAt - Date.now()) : 0);
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
  return { remainingMs, seconds: Math.ceil(remainingMs / 1e3) };
}
export {
  useServerCountdown
};
