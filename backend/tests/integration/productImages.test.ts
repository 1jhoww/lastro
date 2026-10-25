import { describe, it, expect } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { registerFixture, tenantHeaders } from '../helpers/fixture.js';
import { productInput } from '../helpers/commercial.js';
import { productView } from '../../src/shared/schemas/commercial.js';

const f = registerFixture({ rateLimitMax: 10000 });
const headers = () => tenantHeaders(f.ownerA, f.tenantA.tenant.id);
const create = async () =>
  productView.parse(
    (await request(f.app).post('/api/v1/products').set(headers()).send(productInput()).expect(201))
      .body.data,
  );
const read = async (id: string) =>
  productView.parse(
    (await request(f.app).get(`/api/v1/products/${id}`).set(headers()).expect(200)).body.data,
  );
const put = (id: string, version: number, body: Buffer, type: string) =>
  request(f.app)
    .put(`/api/v1/products/${id}/image?expectedVersion=${version}`)
    .set(headers())
    .set('Content-Type', type)
    .send(body);
const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#8a2be2' } });
const files = async () =>
  (await f.firebase.bucket.getFiles({ prefix: `tenants/${f.tenantA.tenant.id}/products/` }))[0];

describe('Imagens de produto em cadastro real', () => {
  it('aceita foto de fornecedor com extensão trocada e foto grande, reduzindo para catálogo', async () => {
    const product = await create();
    // WebP saved as ".jpg": the browser declares image/jpeg.
    const disguised = await photo(800, 600).webp().toBuffer();
    const first = productView.parse(
      (await put(product.id, product.version, disguised, 'image/jpeg').expect(200)).body.data,
    );
    expect(first.image).toMatchObject({ contentType: 'image/webp', width: 800, height: 600 });
    // 4500 × 3000 (13.5 MP) PNG: previously refused, now stored at 2048 px.
    const large = await photo(4500, 3000).png().toBuffer();
    const second = productView.parse(
      (await put(product.id, first.version, large, 'image/png').expect(200)).body.data,
    );
    expect(second.image).toMatchObject({ width: 2048, height: 1365 });
    expect(second.image!.id).not.toBe(first.image!.id);
  });
  it('falha de imagem preserva o produto cadastrado e permite enviar depois', async () => {
    const product = await create();
    for (const [body, type, status, code] of [
      [Buffer.from('<svg/>'), 'image/svg+xml', 422, 'UNSUPPORTED_IMAGE_FORMAT'],
      [Buffer.from('arquivo quebrado'), 'image/jpeg', 422, 'UNSUPPORTED_IMAGE_FORMAT'],
      [Buffer.alloc(5 * 1024 * 1024 + 1), 'image/jpeg', 413, undefined],
    ] as const) {
      const refused = await put(product.id, product.version, body, type).expect(status);
      if (code) expect(refused.body.error.code).toBe(code);
    }
    const truncated = (await photo(64, 64).jpeg().toBuffer()).subarray(0, 120);
    expect(
      (await put(product.id, product.version, truncated, 'image/jpeg').expect(422)).body.error.code,
    ).toBe('INVALID_IMAGE');
    // Product untouched: same version, no image, nothing left in Storage.
    expect(await read(product.id)).toMatchObject({ version: product.version, image: null });
    expect(await files()).toHaveLength(0);
    // The image can be added later from the product page.
    const later = await put(
      product.id,
      product.version,
      await photo(40, 40).jpeg().toBuffer(),
      'image/jpeg',
    ).expect(200);
    expect(later.body.data.image).toMatchObject({ width: 40 });
  });
});
