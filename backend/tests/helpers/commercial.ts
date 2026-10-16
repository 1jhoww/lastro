import request from 'supertest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { bearer, tenantHeaders, newUser, type Fixture } from './fixture.js';
export async function seller(f: Fixture, label = 'seller', tenantId = f.tenantA.tenant.id) {
  const user = await newUser(f, label);
  const owner = tenantId === f.tenantA.tenant.id ? f.ownerA : f.ownerB;
  const invite = await request(f.app)
    .post('/api/v1/users/invitations')
    .set(tenantHeaders(owner, tenantId))
    .send({ email: user.email, role: 'seller' })
    .expect(201);
  await request(f.app)
    .post('/api/v1/users/invitations/accept')
    .set(bearer(user))
    .send({ token: invite.body.data.token })
    .expect(200);
  return user;
}
/**
 * Synthetic capacity for scenarios with several sellers. No official plan offers 5 users, so
 * the contract snapshot is written directly; enforcement reads this same snapshot.
 */
export async function extraSeats(f: Fixture) {
  await f.firebase.db.doc(`subscriptions/${f.tenantA.subscription.id}`).update({ userLimit: 5 });
}
/** Complete address: required on every customer created or edited through the API. */
export const validAddress = {
  postalCode: '01310-100',
  street: 'Avenida Paulista',
  number: '1000',
  district: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
};
export const customerInput = {
  name: 'Cliente Sintético',
  address: validAddress,
  document: '529.982.247-25',
  phone: '(11) 99999-0000',
};
export const productInput = (sku = `sku-${randomUUID()}`) => ({
  name: 'Produto Sintético',
  sku,
  unit: 'UN',
  priceCents: 2050,
});
export const png = () =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })
    .png()
    .toBuffer();
