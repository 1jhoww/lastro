import type { RequestHandler } from 'express';

export const READY_CACHE_MS = 1000;
export const READY_FAILURE_MS = 250;
export const READY_PROBE_MS = 1000;

export function readiness(probe: () => Promise<unknown>, clock = Date.now): RequestHandler {
  let cached = false,
    until = 0;
  let rawPending = false;
  let flight: Promise<boolean> | undefined;
  const read = () => {
    if (clock() < until) return Promise.resolve(cached);
    if (flight) return flight;
    // A timed-out RPC keeps its admission slot until the SDK actually settles.
    if (rawPending) return Promise.resolve(false);
    rawPending = true;
    const raw = Promise.resolve()
      .then(probe)
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        rawPending = false;
      });
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), READY_PROBE_MS);
    });
    flight = Promise.race([raw, timeout])
      .then((ok) => {
        clearTimeout(timer);
        cached = ok;
        until = clock() + (ok ? READY_CACHE_MS : READY_FAILURE_MS);
        return ok;
      })
      .finally(() => {
        flight = undefined;
      });
    return flight;
  };
  return async (_req, res) => {
    const ok = await read();
    res
      .set('Cache-Control', 'no-store')
      .status(ok ? 200 : 503)
      .json({ status: ok ? 'ok' : 'unavailable' });
  };
}
