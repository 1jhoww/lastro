import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Fixture, TestUser } from './fixture.js';
import { tenantHeaders } from './fixture.js';
import { productInput } from './commercial.js';
export const catalogConfig = (extra: object = {}) => ({
  expectedVersion: 0,
  slug: 'lastro-a',
  enabled: true,
  tradeName: 'Distribuidora Sintética',
  description: 'Produtos para orçamento',
  whatsappNumber: '5511999990000',
  showPrices: true,
  ...extra,
});
export const configure = (
  f: Fixture,
  extra: object = {},
  key = randomUUID(),
  user: TestUser = f.ownerA,
  tenantId = f.tenantA.tenant.id,
) =>
  request(f.app)
    .put('/api/v1/catalog-settings')
    .set(tenantHeaders(user, tenantId))
    .set('Idempotency-Key', key)
    .send(catalogConfig(extra));
export const publicPath = (suffix = '', slug = 'lastro-a') =>
  `/api/v1/public/catalogs/${slug}${suffix}`;
export const quotePreview = (
  f: Fixture,
  lines: { productId: string; quantity: string }[],
  slug = 'lastro-a',
) => request(f.app).post(publicPath('/quote-preview', slug)).send({ lines });
export async function catalogProduct(
  f: Fixture,
  extra: object = {},
  user = f.ownerA,
  tenantId = f.tenantA.tenant.id,
) {
  const response = await request(f.app)
    .post('/api/v1/products')
    .set(tenantHeaders(user, tenantId))
    .send({ ...productInput(), catalogVisible: true, ...extra })
    .expect(201);
  return response.body.data;
}
