import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { deleteApp } from 'firebase-admin/app';
import { DocumentReference } from 'firebase-admin/firestore';
import { createApp } from '../../src/app/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createFirebase } from '../../src/infrastructure/firebase/client.js';
import express from 'express';
import { readiness, READY_CACHE_MS, READY_FAILURE_MS } from '../../src/app/readiness.js';
import { ingressLimit } from '../../src/middlewares/ingressLimit.js';
import { requestContext } from '../../src/middlewares/requestContext.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { processingDeadline } from '../../src/middlewares/processingDeadline.js';

const config = loadConfig({
  NODE_ENV: 'test',
  FIREBASE_PROJECT_ID: 'demo-http-tests',
  RATE_LIMIT_MAX: '2',
});
const firebase = createFirebase(config);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await firebase.db.terminate();
  await deleteApp(firebase.app);
});

describe('F03: proteção HTTP antes do parser', () => {
  it('requisições inválidas concorrentes não ultrapassam cota', async () => {
    const app = createApp(config, firebase);
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        request(app).post('/api/v1/admin/plans').type('json').send('{'),
      ),
    );
    expect(responses.filter((r) => r.status === 400)).toHaveLength(2);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(10);
  });
  it('contabiliza JSON malformado sem depender de autenticação', async () => {
    const app = createApp(config, firebase);
    for (let i = 0; i < 2; i++)
      await request(app).post('/api/v1/admin/plans').type('json').send('{').expect(400);
    await request(app).post('/api/v1/admin/plans').type('json').send('{').expect(429);
  });
  it('preserva requests válidos e impede spoofing por cabeçalhos de IP', async () => {
    const app = createApp(config, firebase);
    await request(app).get('/api/v1/me').set('X-Forwarded-For', '198.51.100.1').expect(401);
    await request(app).get('/api/v1/me').set('Forwarded', 'for=198.51.100.2').expect(401);
    await request(app).get('/api/v1/me').set('X-Real-IP', '198.51.100.3').expect(429);
  });
  it('coalesce probes concorrentes em uma leitura', async () => {
    const get = vi.spyOn(DocumentReference.prototype, 'get').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error('dependência indisponível');
    });
    const app = createApp(config, firebase);
    await Promise.all(
      Array.from({ length: 8 }, () => request(app).get('/health/ready').expect(503)),
    );
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('payload grande também esgota cota anterior ao parser', async () => {
    const app = createApp(config, firebase);
    for (let i = 0; i < 2; i++)
      await request(app)
        .post('/api/v1/admin/plans')
        .send({ name: 'x'.repeat(70_000) })
        .expect(413);
    await request(app).get('/api/v1/me').expect(429);
  });
  it('cache positivo expira, detecta falha e recupera com cache negativo curto', async () => {
    let now = 0,
      failed = false;
    const probe = vi.fn(async () => {
      if (failed) throw new Error('indisponível');
    });
    const app = express();
    app.get(
      '/ready',
      readiness(probe, () => now),
    );
    await request(app).get('/ready').expect(200);
    failed = true;
    await request(app).get('/ready').expect(200);
    expect(probe).toHaveBeenCalledTimes(1);
    now += READY_CACHE_MS + 1;
    await request(app).get('/ready').expect(503);
    failed = false;
    await request(app).get('/ready').expect(503);
    now += READY_FAILURE_MS + 1;
    await request(app).get('/ready').expect(200);
    expect(probe).toHaveBeenCalledTimes(3);
  });
  it('RPC de readiness lenta não abre novas consultas após timeout', async () => {
    let release!: () => void;
    const probe = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const app = express();
    app.get('/ready', readiness(probe));
    await request(app).get('/ready').expect(503);
    await request(app).get('/ready').expect(503);
    expect(probe).toHaveBeenCalledTimes(1);
    release();
  });
  it('clientes distintos recebem cotas independentes e IPv6 agrupa subnet', async () => {
    const app = express();
    app.set('trust proxy', ['loopback']); // This isolated test controls its only proxy.
    app.use(requestContext, ingressLimit(1));
    app.get('/probe', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    await request(app).get('/probe').set('X-Forwarded-For', '198.51.100.1').expect(200);
    await request(app).get('/probe').set('X-Forwarded-For', '198.51.100.2').expect(200);
    await request(app).get('/probe').set('X-Forwarded-For', '198.51.100.1').expect(429);
    await request(app).get('/probe').set('X-Forwarded-For', '2001:db8::1').expect(200);
    await request(app).get('/probe').set('X-Forwarded-For', '2001:db8::2').expect(429);
  });
  it('limita cardinalidade de IPs e renova janela sem confiar em headers', async () => {
    let now = 0;
    const app = express();
    app.set('trust proxy', ['loopback']);
    app.use(
      requestContext,
      ingressLimit(2, () => now, 1),
    );
    app.get('/probe', (_req, res) => res.end());
    app.use(errorHandler);
    await request(app).get('/probe').set('X-Forwarded-For', '198.51.100.1').expect(200);
    await request(app).get('/probe').set('X-Forwarded-For', '198.51.100.2').expect(429);
    now = 60_000;
    await request(app).get('/probe').set('X-Forwarded-For', '198.51.100.2').expect(200);
  });
  it('timeout HTTP informa resultado incerto e permite conclusão tardia sem segunda resposta', async () => {
    const app = express();
    let committed = false;
    app.use(requestContext, processingDeadline(10));
    app.post('/command', async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      committed = true;
      if (!res.writableEnded && !res.destroyed) res.json({ ok: true });
    });
    const response = await request(app).post('/command').expect(503);
    expect(response.body.error.code).toBe('REQUEST_OUTCOME_UNKNOWN');
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(committed).toBe(true);
  });
});
