import { useEffect, useState } from 'react';
/** Respeita Retry-After sem repetir requisições automaticamente. */
export function useCooldown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => {
    if (!seconds) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [seconds]);
  return {
    seconds,
    wait: (duration: number | undefined) => {
      if (duration !== undefined) {
        const current = Date.now();
        setNow(current);
        setUntil(current + duration * 1000);
      }
    },
  };
}
