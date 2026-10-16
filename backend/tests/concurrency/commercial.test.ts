import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { registerFixture, tenantHeaders } from '../helpers/fixture.js';
import {
  seller,
  extraSeats,
  customerInput,
  productInput,
  png,
  validAddress,
} from '../helpers/commercial.js';
const f = registerFixture();
const headers = () => tenantHeaders(f.ownerA, f.tenantA.tenant.id);
describe('Invariantes concorrentes comerciais', () => {
  it('dois cadastros simultâneos com mesmo CPF criam somente um cliente e auditoria', async () => {
    const results = await Promise.all(
      [1, 2].map(() => request(f.app).post('/api/v1/customers').set(headers()).send(customerInput)),
    );
    expect(results.map((v) => v.status).sort()).toEqual([201, 409]);
    const collection = f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/customers`);
    expect((await collection.get()).size).toBe(1);
    expect(
      (
        await f.firebase.db
          .collection(`tenants/${f.tenantA.tenant.id}/auditLogs`)
          .where('action', '==', 'customer.created')
          .get()
      ).size,
    ).toBe(1);
  });
  it('dois produtos simultâneos com mesmo SKU criam somente um', async () => {
    const results = await Promise.all(
      [1, 2].map(() =>
        request(f.app).post('/api/v1/products').set(headers()).send(productInput('SAME')),
      ),
    );
    expect(results.map((v) => v.status).sort()).toEqual([201, 409]);
    expect(
      (await f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/products`).get()).size,
    ).toBe(1);
  });
  it('transferências simultâneas não sobrescrevem versão mais recente', async () => {
    await extraSeats(f);
    const first = await seller(f, 'first');
    const second = await seller(f, 'second');
    const result = await request(f.app)
      .post('/api/v1/customers')
      .set(headers())
      .send({ address: validAddress, name: 'Transferível' })
      .expect(201);
    const path = `/api/v1/customers/${result.body.data.id}/assignment`;
    const outcomes = await Promise.all(
      [first.uid, second.uid].map((assignedTo) =>
        request(f.app).patch(path).set(headers()).send({ expectedVersion: 1, assignedTo }),
      ),
    );
    expect(outcomes.map((v) => v.status).sort()).toEqual([200, 409]);
    const winner = outcomes.find((v) => v.status === 200)!;
    const saved = await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/customers/${result.body.data.id}`)
      .get();
    expect(saved.get('assignedTo')).toBe(winner.body.data.assignedTo);
    expect(saved.get('version')).toBe(2);
  });
  it('transferência e edição antiga do vendedor revalidam propriedade dentro da transação', async () => {
    const user = await seller(f);
    const created = await request(f.app)
      .post('/api/v1/customers')
      .set(headers())
      .send({ address: validAddress, name: 'Carteira', assignedTo: user.uid })
      .expect(201);
    const path = `/api/v1/customers/${created.body.data.id}`;
    const results = await Promise.all([
      request(f.app)
        .patch(`${path}/assignment`)
        .set(headers())
        .send({ expectedVersion: 1, assignedTo: null }),
      request(f.app)
        .patch(path)
        .set(tenantHeaders(user, f.tenantA.tenant.id))
        .send({ expectedVersion: 1, notes: 'Edição concorrente' }),
    ]);
    expect(results.filter((v) => v.status === 200)).toHaveLength(1);
    expect([404, 409]).toContain(results.find((v) => v.status !== 200)!.status);
  });
  it('dois preços concorrentes preservam uma decisão e auditoria', async () => {
    const created = await request(f.app)
      .post('/api/v1/products')
      .set(headers())
      .send(productInput())
      .expect(201);
    const path = `/api/v1/products/${created.body.data.id}`;
    const outcomes = await Promise.all(
      [100, 200].map((priceCents) =>
        request(f.app).patch(path).set(headers()).send({ expectedVersion: 1, priceCents }),
      ),
    );
    expect(outcomes.map((v) => v.status).sort()).toEqual([200, 409]);
    expect((await request(f.app).get(path).set(headers()).expect(200)).body.data.priceCents).toBe(
      outcomes.find((v) => v.status === 200)!.body.data.priceCents,
    );
  });
  it('uploads concorrentes vinculam um objeto e removem o perdedor', async () => {
    const created = await request(f.app)
      .post('/api/v1/products')
      .set(headers())
      .send(productInput())
      .expect(201);
    const path = `/api/v1/products/${created.body.data.id}/image?expectedVersion=1`;
    const data = await png();
    const outcomes = await Promise.all(
      [1, 2].map(() =>
        request(f.app).put(path).set(headers()).set('Content-Type', 'image/png').send(data),
      ),
    );
    expect(outcomes.map((v) => v.status).sort()).toEqual([200, 409]);
    const [files] = await f.firebase.bucket.getFiles({
      prefix: `tenants/${f.tenantA.tenant.id}/products/${created.body.data.id}/`,
    });
    expect(files).toHaveLength(1);
  });
});
