import { describe, it, expect } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { registerFixture, tenantHeaders, bearer } from '../helpers/fixture.js';
import { configure, publicPath, catalogProduct } from '../helpers/catalog.js';
import { draft } from '../helpers/orders.js';
import { pdfText } from '../helpers/documents.js';
import { tenantView } from '../../src/shared/schemas/http.js';

const f = registerFixture({ rateLimitMax: 10000 });
const headers = (user = f.ownerA, tenantId = f.tenantA.tenant.id) => tenantHeaders(user, tenantId);
const png = (width: number, height: number, background = '#8a2be2') =>
  sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer();
const binary = (req: request.Test) =>
  req.buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  });
const images = (bytes: Buffer) => bytes.toString('latin1').split('/Subtype /Image').length - 1;
const current = async (user = f.ownerA, tenantId = f.tenantA.tenant.id) =>
  tenantView.parse(
    (await request(f.app).get('/api/v1/tenants/current').set(headers(user, tenantId)).expect(200))
      .body.data,
  );
const uploadLogo = async (
  version: number,
  user = f.ownerA,
  tenantId = f.tenantA.tenant.id,
  status = 200,
) =>
  request(f.app)
    .put(`/api/v1/tenants/current/logo?expectedVersion=${version}`)
    .set(headers(user, tenantId))
    .set('Content-Type', 'image/png')
    .send(await png(900, 300, '#d63384'))
    .expect(status);
const commercialPdf = async (orderId: string) =>
  (
    await binary(
      request(f.app).get(`/api/v1/orders/${orderId}/documents/commercial.pdf`).set(headers()),
    ).expect(200)
  ).body as Buffer;
const subscriptionVersion = async () =>
  (await f.firebase.db.doc(`subscriptions/${f.tenantA.subscription.id}`).get()).get(
    'version',
  ) as number;
/** Plan change through the real Super Admin route, as the platform would do it. */
async function changePlan(planCode: 'essencial' | 'profissional') {
  const preview = (
    await request(f.app)
      .get(
        `/api/v1/admin/subscriptions/${f.tenantA.subscription.id}/plan-change?planCode=${planCode}`,
      )
      .set(bearer(f.platform))
      .expect(200)
  ).body.data;
  await request(f.app)
    .post(`/api/v1/admin/subscriptions/${f.tenantA.subscription.id}/plan`)
    .set(bearer(f.platform))
    .send({
      expectedVersion: await subscriptionVersion(),
      planCode,
      acknowledgedLostFeatures: preview.lostFeatures,
      reason: planCode === 'essencial' ? 'Downgrade de teste' : 'Upgrade de teste',
    })
    .expect(200);
  return preview.lostFeatures as string[];
}
/** Order with two products: one with a photo, one without. */
async function orderWithPhoto() {
  const withPhoto = await catalogProduct(f, { name: 'Drean Color Azul' });
  const put = await request(f.app)
    .put(`/api/v1/products/${withPhoto.id}/image?expectedVersion=1`)
    .set(headers())
    .set('Content-Type', 'image/png')
    .send(await png(600, 600))
    .expect(200);
  expect(put.body.data.image).toBeTruthy();
  // A product without photo (from the order helper) next to the photographed one.
  const order = await draft(f);
  const mixed = await request(f.app)
    .post('/api/v1/orders')
    .set(headers())
    .send({
      customerId: order.customerId,
      lines: [
        { productId: order.lines[0]!.productId, quantity: '1' },
        { productId: withPhoto.id, quantity: '2' },
      ],
      payment: { type: 'cash', dueDates: ['2090-01-01'] },
    })
    .expect(201);
  return { order: mixed.body.data as { id: string }, product: withPhoto as { id: string } };
}

describe('Identidade visual condicionada ao plano', () => {
  it('Profissional: logotipo e fotos nos PDFs, catálogo com logotipo', async () => {
    const start = await current();
    await uploadLogo(start.version);
    const { order } = await orderWithPhoto();
    const bytes = await commercialPdf(order.id);
    // Photo (1) + logo image and its transparency mask, or opaque logo (>= 1).
    expect(images(bytes)).toBeGreaterThanOrEqual(2);
    const text = (await pdfText(bytes)).text;
    expect(text).toContain('Drean Color Azul');
    expect(text).toContain('lastro');
    await configure(f).expect(200);
    const profile = (await request(f.app).get(publicPath()).expect(200)).body.data;
    const logoId = (await current()).logo!.id;
    expect(profile.logo).toEqual({
      path: `/api/v1/public/catalogs/lastro-a/logo?v=${logoId}`,
      width: 900,
      height: 300,
    });
    const served = await binary(request(f.app).get(publicPath('/logo'))).expect(200);
    expect(served.headers['content-type']).toMatch(/^image\/webp/);
    expect(served.headers['cache-control']).toBe('no-store');
  });
  it('Essencial: envio de logotipo recusado pela API; PDFs só com nome e Lastro', async () => {
    const start = await current();
    await uploadLogo(start.version);
    const { order } = await orderWithPhoto();
    const lost = await changePlan('essencial');
    expect(lost).toContain('branding.custom');
    const me = (await request(f.app).get('/api/v1/me').set(bearer(f.ownerA)).expect(200)).body.data;
    expect(me.memberships[0].permissions).not.toContain('branding:manage');
    expect(me.memberships[0].permissions).toContain('tenant:update');
    // Direct API calls cannot switch the premium feature on.
    const refused = await uploadLogo((await current()).version, f.ownerA, f.tenantA.tenant.id, 403);
    expect(refused.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    // The name is still editable; the stored logo and product photos are preserved.
    const kept = await current();
    expect(kept.logo).not.toBeNull();
    await request(f.app)
      .patch('/api/v1/tenants/current')
      .set(headers())
      .send({ name: 'Lady Pets Distribuidora', expectedVersion: kept.version })
      .expect(200);
    const [files] = await f.firebase.bucket.getFiles({ prefix: `tenants/${f.tenantA.tenant.id}/` });
    expect(files.some((file) => file.name.includes('/branding/'))).toBe(true);
    expect(files.some((file) => file.name.includes('/products/'))).toBe(true);
    const bytes = await commercialPdf(order.id);
    expect(images(bytes)).toBe(0);
    const text = (await pdfText(bytes)).text;
    expect(text).toContain('Lady Pets Distribuidora');
    expect(text).toContain('Drean Color Azul');
    expect(text).toContain('lastro');
    const report = (
      await binary(
        request(f.app).get('/api/v1/reports/orders-status/export.pdf').set(headers()),
      ).expect(200)
    ).body as Buffer;
    expect(images(report)).toBe(0);
    // Public catalog and its logo are unavailable on Essencial (no cached leftovers either).
    await request(f.app).get(publicPath()).expect(404);
    await request(f.app).get(publicPath('/logo')).expect(404);
    // Seller and other companies remain refused as before.
    await request(f.app).get('/api/v1/tenants/current/logo').set(headers(f.ownerB)).expect(403);
  });
  it('downgrade e novo upgrade: configurações reaproveitadas sem novo envio', async () => {
    await configure(f).expect(200);
    const start = await current();
    await uploadLogo(start.version);
    const { order } = await orderWithPhoto();
    const logoId = (await current()).logo!.id;
    await changePlan('essencial');
    await request(f.app).get(publicPath('/logo')).expect(404);
    expect(images(await commercialPdf(order.id))).toBe(0);
    // Removing a stored logo stays possible without the feature (it is the company's data).
    expect((await current()).logo!.id).toBe(logoId);
    await changePlan('profissional');
    expect((await current()).logo!.id).toBe(logoId);
    expect(images(await commercialPdf(order.id))).toBeGreaterThanOrEqual(2);
    const profile = (await request(f.app).get(publicPath()).expect(200)).body.data;
    expect(profile.logo.path).toContain(logoId);
    await binary(request(f.app).get(publicPath('/logo'))).expect(200);
  });
  it('catálogo sem logotipo, troca de logotipo e isolamento entre empresas', async () => {
    await configure(f).expect(200);
    expect((await request(f.app).get(publicPath()).expect(200)).body.data.logo).toBeNull();
    await request(f.app).get(publicPath('/logo')).expect(404);
    const first = tenantView.parse((await uploadLogo((await current()).version)).body.data);
    const firstPath = (await request(f.app).get(publicPath()).expect(200)).body.data.logo.path;
    const second = tenantView.parse((await uploadLogo(first.version)).body.data);
    const secondPath = (await request(f.app).get(publicPath()).expect(200)).body.data.logo.path;
    expect(secondPath).not.toBe(firstPath);
    expect(secondPath).toContain(second.logo!.id);
    // Company B publishes its own storefront: it never shows A's logo.
    await configure(
      f,
      { slug: 'lastro-b', tradeName: 'Outra Distribuidora' },
      undefined,
      f.ownerB,
      f.tenantB.tenant.id,
    ).expect(200);
    expect(
      (await request(f.app).get(publicPath('', 'lastro-b')).expect(200)).body.data.logo,
    ).toBeNull();
    await request(f.app).get(publicPath('/logo', 'lastro-b')).expect(404);
    // Disabled storefront: header and logo disappear at once.
    await configure(f, { enabled: false, expectedVersion: 1 }).expect(200);
    await request(f.app).get(publicPath()).expect(404);
    await request(f.app).get(publicPath('/logo')).expect(404);
  });
});
