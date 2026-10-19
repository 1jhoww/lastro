import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { registerFixture } from '../helpers/fixture.js';
import { stockProduct } from '../helpers/inventory.js';
import { orderDocs, orderHeaders, draft, command } from '../helpers/orders.js';
import { FoundationRepository } from '../../src/infrastructure/repositories/foundationRepository.js';
import { productSchema } from '../../src/shared/schemas/commercial.js';
import { ReadGate } from '../../src/shared/operations/readBudget.js';

const f = registerFixture({ preserveExisting: true });
describe('Batched order product reads retain validation and transaction scope', () => {
  it('keeps input order, duplicates and missing documents across a batch boundary', async () => {
    const id = await stockProduct(f);
    const base = (await orderDocs(f, 'products').doc(id).get()).data();
    const refs = Array.from({ length: 105 }, (_, i) =>
      orderDocs(f, 'products').doc(`batch-product-${i}`),
    );
    const batch = f.firebase.db.batch();
    refs.forEach((ref) => batch.create(ref, productSchema.parse({ ...base, id: ref.id })));
    await batch.commit();
    const input = [refs[104]!, ...refs, orderDocs(f, 'products').doc('missing-product'), refs[0]!];
    const repo = new FoundationRepository(f.firebase.db);
    const values = await f.firebase.db.runTransaction(
      (tx) => repo.readMany(input, productSchema, tx),
      { readOnly: true },
    );
    expect(values.map((v) => v?.id ?? null)).toEqual(
      input.map((ref) => (ref.id === 'missing-product' ? null : ref.id)),
    );
    expect(
      await f.firebase.db.runTransaction((tx) => repo.readMany([], productSchema, tx)),
    ).toEqual([]);
  });
  it('rejects malformed data and enforces the same read memory budget', async () => {
    const id = await stockProduct(f);
    const ref = orderDocs(f, 'products').doc(id);
    const repo = new FoundationRepository(f.firebase.db);
    await expect(
      new ReadGate(1, 5000, 1).run(() =>
        f.firebase.db.runTransaction((tx) => repo.readMany([ref], productSchema, tx)),
      ),
    ).rejects.toMatchObject({ code: 'READ_MEMORY_LIMIT' });
    await ref.update({ priceCents: -1 });
    await expect(
      f.firebase.db.runTransaction((tx) => repo.readMany([ref], productSchema, tx)),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
  it('does not reuse a previous transaction or accept a different tenant in order snapshots', async () => {
    const id = await stockProduct(f);
    const ref = orderDocs(f, 'products').doc(id);
    const repo = new FoundationRepository(f.firebase.db);
    await f.firebase.db.runTransaction((tx) => repo.readMany([ref], productSchema, tx));
    await ref.update({ priceCents: 3000 });
    expect(
      (await f.firebase.db.runTransaction((tx) => repo.readMany([ref], productSchema, tx)))[0]
        ?.priceCents,
    ).toBe(3000);
    await ref.update({ tenantId: f.tenantB.tenant.id });
    await request(f.app)
      .post('/api/v1/orders')
      .set(orderHeaders(f))
      .send({ lines: [{ productId: id, quantity: '1' }] })
      .expect(404);
  });
  it('revalidates inactive products on confirmation and rejects absent products', async () => {
    const order = await draft(f);
    await orderDocs(f, 'products').doc(order.lines[0]!.productId).update({ status: 'inactive' });
    await command(f, order, 'confirm').expect(409);
    await request(f.app)
      .post('/api/v1/orders')
      .set(orderHeaders(f))
      .send({ lines: [{ productId: 'missing-product', quantity: '1' }] })
      .expect(404);
  });
});
