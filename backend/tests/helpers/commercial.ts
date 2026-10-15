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
export async function extraSeats(f: Fixture) {
  await request(f.app)
    .patch(`/api/v1/admin/subscriptions/${f.tenantA.subscription.id}`)
    .set(bearer(f.platform))
    .send({ expectedVersion: 1, userLimit: 5, reason: 'Capacidade sintética de teste' })
    .expect(200);
}
export const customerInput = {
  name: 'Cliente Sintético',
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
