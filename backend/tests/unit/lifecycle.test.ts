import { createServer, type Server } from 'node:http';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationLifecycle, gracefulShutdown, tracked } from '../../src/app/lifecycle.js';
import { processingDeadline } from '../../src/middlewares/processingDeadline.js';
import { requestContext } from '../../src/middlewares/requestContext.js';
import { readiness } from '../../src/app/readiness.js';

const listen = (server: Server) =>
  new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

describe('application shutdown', () => {
  it('keeps liveness independent and refuses readiness/new writes while draining', async () => {
    const lifecycle = new ApplicationLifecycle();
    const probe = vi.fn(async () => undefined);
    const write = vi.fn();
    const app = express();
    app.use(requestContext, lifecycle.middleware);
    app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
    app.get('/health/ready', readiness(probe));
    app.post(
      '/command',
      tracked((_req, res) => {
        write();
        res.end();
      }),
    );
    await request(app).get('/health/ready').expect(200);
    expect(probe).toHaveBeenCalledTimes(1);
    lifecycle.beginDrain();
    await request(app).get('/health/live').expect(200);
    const ready = await request(app).get('/health/ready').expect(503);
    expect(ready.headers['cache-control']).toBe('no-store');
    expect(probe).toHaveBeenCalledTimes(1);
    const denied = await request(app).post('/command').expect(503);
    expect(denied.body.error.code).toBe('SERVICE_DRAINING');
    expect(denied.headers['retry-after']).toBe('1');
    expect(write).not.toHaveBeenCalled();
  });

  it('waits for a timed-out handler before terminating its SDK and coalesces signals', async () => {
    const lifecycle = new ApplicationLifecycle();
    let release!: () => void;
    const effect = vi.fn();
    const cleanup = vi.fn(async () => undefined);
    const exit = vi.fn();
    const app = express();
    app.use(requestContext, lifecycle.middleware, processingDeadline(10));
    app.post(
      '/command',
      tracked(async (_req, res) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        effect();
        if (!res.writableEnded && !res.destroyed) res.end();
      }),
    );
    const server = createServer(app);
    await listen(server);
    try {
      const response = await request(server).post('/command').expect(503);
      expect(response.body.error.code).toBe('REQUEST_OUTCOME_UNKNOWN');
      const stop = gracefulShutdown(server, lifecycle, cleanup, exit, 1000, vi.fn());
      const first = stop();
      expect(stop()).toBe(first);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(cleanup).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      release();
      await first;
      expect(effect).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('exits on the bounded deadline without terminating SDK under pending work', async () => {
    const lifecycle = new ApplicationLifecycle();
    let release!: () => void;
    const pending = lifecycle.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const server = createServer();
    await listen(server);
    const cleanup = vi.fn(async () => undefined),
      exit = vi.fn(),
      log = vi.fn();
    await gracefulShutdown(server, lifecycle, cleanup, exit, 30, log)();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(log).toHaveBeenCalledWith('server.shutdown_timeout');
    expect(cleanup).not.toHaveBeenCalled();
    release();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cleanup).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('waits for the underlying readiness RPC after the probe response times out', async () => {
    const lifecycle = new ApplicationLifecycle();
    let release!: () => void;
    const app = express();
    app.use(requestContext, lifecycle.middleware);
    app.get(
      '/health/ready',
      readiness(() =>
        lifecycle.run(
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        ),
      ),
    );
    const server = createServer(app);
    await listen(server);
    const cleanup = vi.fn(async () => undefined),
      exit = vi.fn();
    try {
      await request(server).get('/health/ready').expect(503);
      const stopped = gracefulShutdown(server, lifecycle, cleanup, exit, 2000, vi.fn())();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(cleanup).not.toHaveBeenCalled();
      release();
      await stopped;
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('handles cleanup rejection with a safe event and one failed exit', async () => {
    const server = createServer();
    await listen(server);
    const exit = vi.fn(),
      log = vi.fn();
    await gracefulShutdown(
      server,
      new ApplicationLifecycle(),
      async () => {
        throw new Error('synthetic-sensitive-error');
      },
      exit,
      1000,
      log,
    )();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(log).toHaveBeenCalledWith('server.shutdown_failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-sensitive-error');
  });
});
