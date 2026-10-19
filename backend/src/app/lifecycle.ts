import { AsyncLocalStorage } from 'node:async_hooks';
import type { Server } from 'node:http';
import type { RequestHandler } from 'express';

const operations = new AsyncLocalStorage<ApplicationLifecycle>();
export const SHUTDOWN_GRACE_MS = 9000;

/** Tracks handler completion, which can occur after its HTTP response timed out. */
export class ApplicationLifecycle {
  private draining = false;
  private active = 0;
  private readonly idle = new Set<() => void>();

  readonly middleware: RequestHandler = (req, res, next) => {
    if (this.draining && req.path !== '/health/live') {
      res.set('Connection', 'close').set('Retry-After', '1');
      if (req.path === '/health/ready') {
        res.status(503).json({ status: 'unavailable' });
      } else {
        res.status(503).json({
          error: {
            code: 'SERVICE_DRAINING',
            status: 503,
            message: 'Servidor encerrando; consulte o estado antes de repetir comandos.',
            requestId: req.requestId,
          },
        });
      }
      return;
    }
    operations.run(this, next);
  };

  beginDrain() {
    this.draining = true;
  }

  async run(work: () => unknown) {
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
      if (this.active === 0) {
        for (const resolve of this.idle) resolve();
        this.idle.clear();
      }
    }
  }

  whenIdle(): Promise<void> {
    return this.active === 0 ? Promise.resolve() : new Promise((resolve) => this.idle.add(resolve));
  }
}

export function tracked(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const lifecycle = operations.getStore();
    return lifecycle ? lifecycle.run(() => handler(req, res, next)) : handler(req, res, next);
  };
}

export function gracefulShutdown(
  server: Server,
  lifecycle: ApplicationLifecycle,
  cleanup: () => Promise<void>,
  exit: (code: number) => void = process.exit,
  timeoutMs = SHUTDOWN_GRACE_MS,
  log: (event: string) => void = (event) => console.log(JSON.stringify({ event })),
): () => Promise<void> {
  let flight: Promise<void> | undefined;
  return () => {
    if (flight) return flight;
    lifecycle.beginDrain();
    log('server.draining');
    flight = new Promise<void>((resolve) => {
      let finished = false;
      const finish = (code: number, event: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        log(event);
        exit(code);
        resolve();
      };
      // Leave one second before Cloud Run's SIGKILL. Never promise rollback of pending work.
      const timer = setTimeout(() => {
        server.closeAllConnections();
        finish(1, 'server.shutdown_timeout');
      }, timeoutMs);
      const closed = new Promise<void>((done, reject) => {
        server.close((error) => (error ? reject(error) : done()));
      });
      void Promise.all([closed, lifecycle.whenIdle()])
        .then(async () => {
          if (finished) return;
          await cleanup();
          finish(0, 'server.stopped');
        })
        .catch(() => finish(1, 'server.shutdown_failed'));
    });
    return flight;
  };
}
