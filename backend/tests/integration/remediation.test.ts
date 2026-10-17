import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Timestamp, Transaction } from 'firebase-admin/firestore';
import { registerFixture, bearer, tenantHeaders, tenantInput } from '../helpers/fixture.js';
import { png, productInput } from '../helpers/commercial.js';
import { draft } from '../helpers/orders.js';
import { FoundationRepository } from '../../src/infrastructure/repositories/foundationRepository.js';
import { CommercialRepository } from '../../src/infrastructure/repositories/commercialRepository.js';
import { AccessService } from '../../src/modules/auth/accessService.js';
import { ProductService } from '../../src/modules/products/productService.js';
import { ImageService } from '../../src/modules/products/imageService.js';
import { DocumentService } from '../../src/modules/documents/documentService.js';
import { PdfRenderer } from '../../src/modules/documents/pdfRenderer.js';
import { ReadGate } from '../../src/shared/operations/readBudget.js';
import { idempotencySchema } from '../../src/shared/schemas/models.js';
import { openApiDocument } from '../../src/modules/auth/openapi.js';
import { conditionView } from '../../src/shared/schemas/paymentSettings.js';
import type { Actor } from '../../src/shared/types/context.js';
import { readFileSync } from 'node:fs';
import { FinancialService } from '../../src/modules/finance/financialService.js';
import { financialOrder, receiptBody, financePost, titles } from '../helpers/finance.js';
import { createApp } from '../../src/app/app.js';

const f = registerFixture({ rateLimitMax: 10000 });
afterEach(() => vi.restoreAllMocks());
const actor = (user = f.ownerA): Actor => ({
  ...user,
  emailVerified: true,
  authTime: Math.floor(Date.now() / 1000),
  requestId: randomUUID(),
});
const headers = () => tenantHeaders(f.ownerA, f.tenantA.tenant.id);
const images = () => {
  const foundation = new FoundationRepository(f.firebase.db);
  return new ImageService(
    new ProductService(
      new CommercialRepository(foundation, f.config.invitationSecret),
      new AccessService(foundation),
      () => new Date(Date.now() + f.offset),
    ),
    f.firebase,
  );
};
const imageJob = (id: string) =>
  f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}/imageCleanup/${id}`);
async function productWithImage() {
  const product = (
    await request(f.app).post('/api/v1/products').set(headers()).send(productInput()).expect(201)
  ).body.data;
  return (
    await request(f.app)
      .put(`/api/v1/products/${product.id}/image?expectedVersion=1`)
      .set(headers())
      .type('image/png')
      .send(await png())
      .expect(200)
  ).body.data as { id: string; image: { id: string } };
}

describe('F03–F07: regressões nos emuladores', () => {
  it('TTL destina-se somente aos contadores e expiração administrativa conserva bloqueio de replay', async () => {
    const key = randomUUID(),
      body = tenantInput('Empresa retida', f.outsider.email);
    const call = () =>
      request(f.app)
        .post('/api/v1/admin/tenants')
        .set(bearer(f.platform))
        .set('Idempotency-Key', key)
        .send(body);
    const first = (await call().expect(201)).body.data.tenant;
    expect((await call().expect(201)).body.data.tenant.id).toBe(first.id);
    const records = await f.firebase.db
      .collection('idempotencyRecords')
      .where('result.id', '==', first.id)
      .get();
    const ref = records.docs[0]!.ref;
    expect((await ref.get()).get('expiresAt')).toBeInstanceOf(Timestamp);
    const count = (await f.firebase.db.collection('tenants').get()).size;
    await ref.update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    expect((await call().expect(410)).body.error.code).toBe('IDEMPOTENCY_EXPIRED');
    expect((await f.firebase.db.collection('tenants').get()).size).toBe(count);
    expect((await ref.get()).exists).toBe(true);
    // Legacy textual expiry is readable and has the same fail-closed replay behavior.
    await ref.update({ expiresAt: new Date(Date.now() - 1).toISOString() });
    await call().expect(410);
    expect(idempotencySchema.parse((await ref.get()).data()).result.id).toBe(first.id);
    const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as {
      fieldOverrides: { collectionGroup: string; fieldPath: string; ttl?: boolean }[];
    };
    expect(indexes.fieldOverrides.filter((v) => v.ttl)).toEqual([
      { collectionGroup: 'rateLimits', fieldPath: 'expiresAt', ttl: true, indexes: [] },
    ]);
  });
  it('limpeza não usa idade para excluir upload ainda em andamento', async () => {
    const product = (
      await request(f.app).post('/api/v1/products').set(headers()).send(productInput()).expect(201)
    ).body.data;
    const file = f.firebase.bucket.file(
      `tenants/${f.tenantA.tenant.id}/products/${product.id}/held.webp`,
    );
    const service = images();
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.firebase.bucket, 'file').mockReturnValue(file);
    vi.spyOn(file, 'save').mockImplementationOnce(async () => {
      started();
      await hold;
    });
    const pending = service.upload(
      actor(),
      f.tenantA.tenant.id,
      product.id,
      1,
      await png(),
      'image/png',
    );
    try {
      await ready;
      const jobs = await f.firebase.db
        .collection(`tenants/${f.tenantA.tenant.id}/imageCleanup`)
        .get();
      expect(jobs.size).toBe(1);
      f.offset = 2 * 86400000;
      expect(
        await service.cleanup(actor(), f.tenantA.tenant.id, product.id, jobs.docs[0]!.id),
      ).toBe(false);
      expect((await jobs.docs[0]!.ref.get()).get('kind')).toBe('uploading');
    } finally {
      release();
    }
    await pending;
  });
  it('imagem retirada aguarda retenção e limpeza conserva imagem ativa', async () => {
    const first = await productWithImage();
    const second = (
      await request(f.app)
        .put(`/api/v1/products/${first.id}/image?expectedVersion=2`)
        .set(headers())
        .type('image/png')
        .send(await png())
        .expect(200)
    ).body.data;
    const service = images(),
      tenantId = f.tenantA.tenant.id;
    expect((await imageJob(first.image.id).get()).get('notBefore')).toBeInstanceOf(Timestamp);
    expect(await service.cleanup(actor(), tenantId, first.id, first.image.id)).toBe(false);
    expect(await service.cleanup(actor(), tenantId, first.id, second.image.id)).toBe(false);
    f.offset = 2 * 86400000;
    expect(await service.cleanup(actor(), tenantId, first.id, first.image.id)).toBe(true);
    await request(f.app).get(`/api/v1/products/${first.id}/image`).set(headers()).expect(200);
    const [files] = await f.firebase.bucket.getFiles({
      prefix: `tenants/${tenantId}/products/${first.id}/`,
    });
    expect(files.map((file) => file.name)).toEqual([
      `tenants/${tenantId}/products/${first.id}/${second.image.id}.webp`,
    ]);
  });
  it('limpeza falha mantém job retomável e exige permissão empresarial atual', async () => {
    const product = await productWithImage(),
      service = images(),
      tenantId = f.tenantA.tenant.id;
    await request(f.app)
      .delete(`/api/v1/products/${product.id}/image?expectedVersion=2`)
      .set(headers())
      .expect(200);
    f.offset = 2 * 86400000;
    await expect(
      service.cleanup(actor(f.ownerB), tenantId, product.id, product.image.id),
    ).rejects.toMatchObject({ status: 403 });
    const file = f.firebase.bucket.file(
      `tenants/${tenantId}/products/${product.id}/${product.image.id}.webp`,
    );
    vi.spyOn(f.firebase.bucket, 'file').mockReturnValue(file);
    vi.spyOn(file, 'delete').mockRejectedValueOnce(new Error('Storage indisponível'));
    await expect(service.cleanup(actor(), tenantId, product.id, product.image.id)).rejects.toThrow(
      'Storage indisponível',
    );
    expect((await imageJob(product.image.id).get()).get('status')).toBe('deleting');
    expect(await service.cleanup(actor(), tenantId, product.id, product.image.id)).toBe(true);
    expect((await imageJob(product.image.id).get()).exists).toBe(false);
  });
  it('upload com confirmação de commit perdida mantém referência e objeto ativos', async () => {
    const product = (
      await request(f.app).post('/api/v1/products').set(headers()).send(productInput()).expect(201)
    ).body.data;
    const original = f.firebase.db.runTransaction.bind(f.firebase.db);
    let applied = false;
    vi.spyOn(f.firebase.db, 'runTransaction').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (result && typeof result === 'object' && 'image' in result && result.image) {
        applied = true;
        throw new Error('ack perdido');
      }
      return result;
    });
    await request(f.app)
      .put(`/api/v1/products/${product.id}/image?expectedVersion=1`)
      .set(headers())
      .type('image/png')
      .send(await png())
      .expect(500);
    expect(applied).toBe(true);
    vi.restoreAllMocks();
    await request(f.app).get(`/api/v1/products/${product.id}/image`).set(headers()).expect(200);
    expect(
      (await f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/imageCleanup`).get()).size,
    ).toBe(0);
  });
  it('PDF lento limita leitura inicial e conserva cota até SDK terminar', async () => {
    const order = await draft(f);
    const renderer = new PdfRenderer();
    const service = new DocumentService(undefined!, renderer, new ReadGate(1, 15));
    let release!: () => void;
    const realSource = DocumentService.prototype.source;
    // Obtain a real authorized source through the app service before injecting latency.
    let source!: Awaited<ReturnType<DocumentService['source']>>;
    const spy = vi.spyOn(DocumentService.prototype, 'source').mockImplementation(async function (
      this: DocumentService,
      ...args
    ) {
      source = await realSource.apply(this, args);
      return source;
    });
    await request(f.app)
      .get(`/api/v1/orders/${order.id}/documents/commercial.pdf`)
      .set(headers())
      .expect(200);
    spy.mockRestore();
    vi.spyOn(service, 'source').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(source);
        }),
    );
    const render = vi.spyOn(renderer, 'render');
    await expect(
      service.download(actor(), f.tenantA.tenant.id, order.id, 'commercial'),
    ).rejects.toMatchObject({ code: 'DOCUMENT_TIME_LIMIT' });
    await expect(
      service.download(actor(), f.tenantA.tenant.id, order.id, 'commercial'),
    ).rejects.toMatchObject({ code: 'DOCUMENT_BUSY' });
    release();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(render).not.toHaveBeenCalled();
    await expect(service.budget.run(async () => true)).resolves.toBe(true);
  });
  it('listagem usa projeção pequena e resolve snapshots comerciais um a um', async () => {
    await draft(f);
    await draft(f);
    await draft(f);
    const get = Transaction.prototype.get;
    let active = 0,
      max = 0,
      headersOnly = false;
    vi.spyOn(Transaction.prototype, 'get').mockImplementation(async function (
      this: Transaction,
      ...args
    ) {
      const [ref] = args;
      const orderRead = ref && 'path' in ref && /\/orders\/[^/]+$/.test(String(ref.path));
      if (orderRead) {
        active++;
        max = Math.max(max, active);
      }
      try {
        const result = await get.apply(this, args);
        if (
          result &&
          typeof result === 'object' &&
          'docs' in result &&
          Array.isArray(result.docs) &&
          result.docs.some((d) => /\/orders\/[^/]+$/.test(d.ref.path))
        ) {
          headersOnly = result.docs.every((d) =>
            Object.keys(d.data()).every((k) => k === 'createdAt'),
          );
        }
        return result;
      } finally {
        if (orderRead) active--;
      }
    });
    const page = await request(f.app).get('/api/v1/orders?limit=100').set(headers()).expect(200);
    expect(page.body.data.items).toHaveLength(3);
    expect(headersOnly).toBe(true);
    expect(max).toBe(1);
  });
  it('timeout de resposta financeira permite replay exato sem segundo pagamento', async () => {
    const { order, method } = await financialOrder(f);
    const body = await receiptBody(f, order, method, 500);
    const key = randomUUID();
    const original = FinancialService.prototype.receipt;
    let applied!: () => void, release!: () => void;
    const committed = new Promise<void>((resolve) => {
      applied = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    vi.spyOn(FinancialService.prototype, 'receipt').mockImplementation(async function (
      this: FinancialService,
      ...args
    ) {
      const result = await original.apply(this, args);
      if (first) {
        first = false;
        applied();
        await hold;
      }
      return result;
    });
    const short = createApp(f.config, f.firebase, undefined, 100);
    const pending = request(short)
      .post(`/api/v1/orders/${order.id}/receipts`)
      .set(headers())
      .set('Idempotency-Key', key)
      .send(body)
      .expect(503)
      .then((r) => r);
    try {
      await committed;
      expect((await pending).body.error.code).toBe('REQUEST_OUTCOME_UNKNOWN');
      await financePost(f, `/orders/${order.id}/receipts`, body, key).expect(200);
      expect(
        (await f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/payments`).get()).size,
      ).toBe(1);
      expect((await titles(f, order))[0]).toMatchObject({ cashCents: 500, outstandingCents: 1550 });
    } finally {
      release();
    }
  });
  it('resposta real materializa weight e contrato mantém campo opcional na entrada', async () => {
    const response = await request(f.app)
      .post('/api/v1/payment-conditions')
      .set(headers())
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'Prazo materializado', schedule: [{ offsetDays: 30 }] })
      .expect(201);
    expect(response.body.data.schedule).toEqual([{ offsetDays: 30, weight: 1 }]);
    expect(conditionView.parse(response.body.data)).toEqual(response.body.data);
    const api = openApiDocument();
    const operation = api.paths['/api/v1/payment-conditions']!.post as {
      requestBody: {
        content: {
          'application/json': {
            schema: { properties: { schedule: { items: { required: string[] } } } };
          };
        };
      };
      responses: {
        201: {
          content: {
            'application/json': {
              schema: {
                properties: {
                  data: { properties: { schedule: { items: { required: string[] } } } };
                };
              };
            };
          };
        };
      };
    };
    expect(
      operation.requestBody.content['application/json'].schema.properties.schedule.items.required,
    ).not.toContain('weight');
    expect(
      operation.responses[201].content['application/json'].schema.properties.data.properties
        .schedule.items.required,
    ).toContain('weight');
  });
});
