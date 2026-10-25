import { describe, it, expect } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { registerFixture, tenantHeaders } from '../helpers/fixture.js';
import { seller } from '../helpers/commercial.js';
import { draft, confirm } from '../helpers/orders.js';
import { pdfText } from '../helpers/documents.js';
import { tenantView } from '../../src/shared/schemas/http.js';
import { IMAGE_UPLOADS_PER_HOUR } from '../../src/middlewares/rateLimit.js';

const f = registerFixture({ rateLimitMax: 10000 });
const headers = (user = f.ownerA, tenantId = f.tenantA.tenant.id) => tenantHeaders(user, tenantId);
const current = async (user = f.ownerA, tenantId = f.tenantA.tenant.id) =>
  tenantView.parse(
    (await request(f.app).get('/api/v1/tenants/current').set(headers(user, tenantId)).expect(200))
      .body.data,
  );
const logo = (width = 1600, height = 800) =>
  sharp({
    create: { width, height, channels: 4, background: { r: 200, g: 30, b: 90, alpha: 0.8 } },
  })
    .png()
    .toBuffer();
const upload = (body: Buffer, version: number, user = f.ownerA, tenantId = f.tenantA.tenant.id) =>
  request(f.app)
    .put(`/api/v1/tenants/current/logo?expectedVersion=${version}`)
    .set(headers(user, tenantId))
    .set('Content-Type', 'image/png')
    .send(body);
const binary = (path: string, user = f.ownerA, tenantId = f.tenantA.tenant.id) =>
  request(f.app)
    .get(`/api/v1${path}`)
    .set(headers(user, tenantId))
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
const brandingFiles = async (tenantId = f.tenantA.tenant.id) =>
  (await f.firebase.bucket.getFiles({ prefix: `tenants/${tenantId}/branding/` }))[0].map(
    (file) => file.name,
  );
const audits = async (action: string) =>
  (
    await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/auditLogs`)
      .where('action', '==', action)
      .get()
  ).docs.map((d) => d.data());

describe('Identidade da empresa: nome', () => {
  it('administrador altera o nome com versão e auditoria; vendedor e outra empresa não', async () => {
    const before = await current();
    expect(before.logo).toBeNull();
    const user = await seller(f);
    await request(f.app)
      .patch('/api/v1/tenants/current')
      .set(headers(user))
      .send({ name: 'Nome do vendedor', expectedVersion: before.version })
      .expect(403);
    // Another company's administrator cannot act on this company, even naming it in the header.
    await request(f.app)
      .patch('/api/v1/tenants/current')
      .set(headers(f.ownerB))
      .send({ name: 'Invasão', expectedVersion: before.version })
      .expect(403);
    const renamed = tenantView.parse(
      (
        await request(f.app)
          .patch('/api/v1/tenants/current')
          .set(headers())
          .send({ name: '  Lady Pets Distribuidora  ', expectedVersion: before.version })
          .expect(200)
      ).body.data,
    );
    expect(renamed).toMatchObject({ name: 'Lady Pets Distribuidora', version: before.version + 1 });
    await request(f.app)
      .patch('/api/v1/tenants/current')
      .set(headers())
      .send({ name: 'Versão velha', expectedVersion: before.version })
      .expect(409);
    await request(f.app)
      .patch('/api/v1/tenants/current')
      .set(headers())
      .send({ name: 'L', expectedVersion: renamed.version })
      .expect(422);
    expect((await current(f.ownerB, f.tenantB.tenant.id)).name).toBe('Empresa B');
    expect(await audits('tenant.updated')).toEqual([
      expect.objectContaining({
        actorUid: f.ownerA.uid,
        changes: expect.objectContaining({
          previousName: 'Empresa A',
          name: 'Lady Pets Distribuidora',
        }),
      }),
    ]);
  });
});

describe('Identidade da empresa: logotipo', () => {
  it('envia, lê, substitui e remove sem deixar arquivos órfãos', async () => {
    const start = await current();
    const first = tenantView.parse(
      (await upload(await logo(), start.version).expect(200)).body.data,
    );
    expect(first.logo).toMatchObject({ contentType: 'image/webp', width: 1024, height: 512 });
    expect(first.version).toBe(start.version + 1);
    expect(await brandingFiles()).toEqual([
      `tenants/${f.tenantA.tenant.id}/branding/${first.logo!.id}.webp`,
    ]);
    const read = await binary('/tenants/current/logo').expect(200);
    expect(read.headers['content-type']).toMatch(/^image\/webp/);
    expect(read.headers['cache-control']).toBe('private, no-store');
    const stored = await sharp(read.body as Buffer).metadata();
    expect([stored.format, stored.hasAlpha]).toEqual(['webp', true]);
    // The seller sees the logo (tenant:read) but cannot change it.
    const user = await seller(f);
    await binary('/tenants/current/logo', user).expect(200);
    await upload(await logo(), first.version, user).expect(403);
    // Stale version: refused before anything is stored.
    await upload(await logo(), start.version).expect(409);
    expect(await brandingFiles()).toHaveLength(1);
    const second = tenantView.parse(
      (await upload(await logo(300, 300), first.version).expect(200)).body.data,
    );
    expect(second.logo!.id).not.toBe(first.logo!.id);
    expect(await brandingFiles()).toEqual([
      `tenants/${f.tenantA.tenant.id}/branding/${second.logo!.id}.webp`,
    ]);
    await request(f.app)
      .delete(`/api/v1/tenants/current/logo?expectedVersion=${first.version}`)
      .set(headers())
      .expect(409);
    const removed = tenantView.parse(
      (
        await request(f.app)
          .delete(`/api/v1/tenants/current/logo?expectedVersion=${second.version}`)
          .set(headers())
          .expect(200)
      ).body.data,
    );
    expect(removed.logo).toBeNull();
    expect(await brandingFiles()).toEqual([]);
    await binary('/tenants/current/logo').expect(404);
    await request(f.app)
      .delete(`/api/v1/tenants/current/logo?expectedVersion=${removed.version}`)
      .set(headers())
      .expect(404);
    expect((await audits('tenant.logo.updated')).length).toBe(2);
    expect(await audits('tenant.logo.removed')).toEqual([
      expect.objectContaining({
        actorUid: f.ownerA.uid,
        changes: { previousLogoId: second.logo!.id, logoId: null },
      }),
    ]);
  });
  it('valida formato e tamanho e isola os arquivos por empresa', async () => {
    const version = (await current()).version;
    for (const [type, body, status] of [
      ['image/svg+xml', Buffer.from('<svg/>'), 422],
      ['image/png', Buffer.from('não é imagem'), 422],
      ['image/png', Buffer.alloc(5 * 1024 * 1024 + 1), 413],
    ] as const)
      await request(f.app)
        .put(`/api/v1/tenants/current/logo?expectedVersion=${version}`)
        .set(headers())
        .set('Content-Type', type)
        .send(body)
        .expect(status);
    expect(await brandingFiles()).toEqual([]);
    const a = tenantView.parse((await upload(await logo(), version).expect(200)).body.data);
    // Company B has no logo and cannot read A's, even by naming A in the header.
    await binary('/tenants/current/logo', f.ownerB, f.tenantB.tenant.id).expect(404);
    await binary('/tenants/current/logo', f.ownerB).expect(403);
    await upload(await logo(), a.version, f.ownerB).expect(403);
    await request(f.app)
      .delete(`/api/v1/tenants/current/logo?expectedVersion=${a.version}`)
      .set(headers(f.ownerB))
      .expect(403);
    expect(await brandingFiles(f.tenantB.tenant.id)).toEqual([]);
    expect(await brandingFiles()).toHaveLength(1);
    expect((await current(f.ownerB, f.tenantB.tenant.id)).logo).toBeNull();
  });
  it('documentos e relatórios em PDF mostram nome e logotipo atuais da empresa', async () => {
    const order = await confirm(f, await draft(f));
    const pdf = async (path: string) => (await binary(path).expect(200)).body as Buffer;
    const hasImage = (bytes: Buffer) => bytes.includes('/Subtype /Image');
    const plain = await pdf(`/orders/${order.id}/documents/commercial.pdf`);
    expect(hasImage(plain)).toBe(false);
    const start = await current();
    await request(f.app)
      .patch('/api/v1/tenants/current')
      .set(headers())
      .send({ name: 'Lady Pets Distribuidora', expectedVersion: start.version })
      .expect(200);
    await upload(await logo(), start.version + 1).expect(200);
    for (const path of [
      `/orders/${order.id}/documents/commercial.pdf`,
      `/orders/${order.id}/documents/packing.pdf`,
      '/reports/orders-status/export.pdf',
    ]) {
      const bytes = await pdf(path);
      expect(hasImage(bytes)).toBe(true);
      const text = await pdfText(bytes);
      expect(text.text).toContain('Lady Pets Distribuidora');
      // The Lastro lockup stays: the company identity is added, never swapped in.
      expect(text.text).toContain('lastro');
    }
    // Without a logo the header goes back to the name alone.
    const withLogo = await current();
    await request(f.app)
      .delete(`/api/v1/tenants/current/logo?expectedVersion=${withLogo.version}`)
      .set(headers())
      .expect(200);
    expect(hasImage(await pdf(`/orders/${order.id}/documents/commercial.pdf`))).toBe(false);
  });
});

describe('Envio de imagens em quantidade', () => {
  it('cota de envios é bem maior que a anterior e informa quando tentar de novo', async () => {
    expect(IMAGE_UPLOADS_PER_HOUR).toBe(300);
    // Pre-fill this user's counter for the current hour instead of uploading 300 files.
    const { digest } = await import('../../src/shared/utils/crypto.js');
    const window = Math.floor(Date.now() / 3_600_000);
    await f.firebase.db
      .doc(`rateLimits/${digest(`image-upload:${f.ownerA.uid}:${window}`)}`)
      .set({ count: IMAGE_UPLOADS_PER_HOUR - 1, expiresAt: new Date(Date.now() + 7_200_000) });
    const version = (await current()).version;
    const last = await upload(await logo(), version).expect(200);
    const refused = await upload(await logo(), last.body.data.version).expect(429);
    expect(refused.body.error.code).toBe('RATE_LIMITED');
    const retry = Number(refused.headers['retry-after']);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(3600);
    // Another user keeps a quota of their own.
    const b = await current(f.ownerB, f.tenantB.tenant.id);
    await upload(await logo(), b.version, f.ownerB, f.tenantB.tenant.id).expect(200);
  });
});
