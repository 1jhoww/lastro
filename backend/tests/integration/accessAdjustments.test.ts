import { describe, it, expect } from 'vitest';
import request from 'supertest';
import {
  registerFixture,
  tenantHeaders,
  bearer,
  expectStatus,
  type TestUser,
} from '../helpers/fixture.js';
import { extraSeats, seller } from '../helpers/commercial.js';
import { confirm, draft } from '../helpers/orders.js';
import { pdfText } from '../helpers/documents.js';
import { reportView } from '../../src/shared/schemas/reports.js';

const f = registerFixture({ rateLimitMax: 10000 });
const tenantA = () => f.tenantA.tenant.id;
const report = (id: string, user: TestUser, query: object = {}) =>
  request(f.app).get(`/api/v1/reports/${id}`).query(query).set(tenantHeaders(user, tenantA()));
const view = async (id: string, user: TestUser, query: object = {}) =>
  reportView.parse((await expectStatus(report(id, user, query), 200)).body.data);
const metric = (v: ReturnType<typeof reportView.parse>, key: string) =>
  v.summary.find((m) => m.key === key)?.value;
const withReports = [
  'orders.view',
  'orders.edit',
  'orders.confirm',
  'orders.dispatch',
  'orders.documents',
  'customers.manage',
  'products.view',
  'inventory.view',
  'reports.view',
];
async function grantReports(user: TestUser, expectedVersion = 1) {
  await expectStatus(
    request(f.app)
      .patch(`/api/v1/users/${user.uid}/permissions`)
      .set(tenantHeaders(f.ownerA, tenantA()))
      .send({ operations: withReports, expectedVersion }),
    200,
  );
}
const member = async (uid: string) =>
  (await f.firebase.db.doc(`tenants/${tenantA()}/memberships/${uid}`).get()).data()!;
const platformStatus = (uid: string, status: 'active' | 'disabled', expectedVersion: number) =>
  request(f.app)
    .post(`/api/v1/admin/companies/${tenantA()}/users/${uid}/status`)
    .set(bearer(f.platform))
    .send({ status, expectedVersion, reason: 'Ajuste de acesso' });

describe('Relatórios do vendedor restritos à carteira', () => {
  it('carteira, outro vendedor, vendedor sem clientes, exportações, admin e financeiro', async () => {
    await extraSeats(f);
    const a = await seller(f, 'va');
    const b = await seller(f, 'vb');
    const empty = await seller(f, 'vc');
    for (const user of [a, b, empty]) await grantReports(user);
    const orderA = await confirm(f, await draft(f, a), a);
    const orderB = await confirm(f, await draft(f, b), b);
    await confirm(f, await draft(f));

    // Administrator keeps the company view.
    expect(metric(await view('sales-period', f.ownerA), 'orders')).toBe(3);

    const salesA = await view('sales-period', a);
    expect(metric(salesA, 'orders')).toBe(1);
    expect(metric(salesA, 'net')).toBe(orderA.totalCents);
    expect(salesA.filters).toContainEqual({ label: 'Escopo', value: 'Sua carteira de clientes' });
    const customersA = await view('sales-customers', a);
    expect(customersA.rows).toHaveLength(1);
    expect(customersA.rows[0]!.link).toEqual({ kind: 'customer', id: orderA.customerId });
    expect((await view('sales-products', a)).rows).toHaveLength(1);
    expect((await view('sales-sellers', a)).rows).toHaveLength(1);
    expect(metric(await view('orders-status', a), 'confirmed')).toBe(1);

    // Another seller's customer or seller id cannot widen the scope.
    expect((await report('sales-period', a, { customerId: orderB.customerId })).status).toBe(404);
    expect((await report('sales-period', a, { sellerUid: b.uid })).status).toBe(403);

    // A seller with no customers sees empty results, never company figures.
    const none = await view('sales-period', empty);
    expect(metric(none, 'orders')).toBe(0);
    expect(metric(none, 'net')).toBe(0);
    expect((await view('sales-customers', empty)).rows).toHaveLength(0);

    // Files use the very same scope.
    const csv = await expectStatus(
      request(f.app)
        .get('/api/v1/reports/orders-status/export.csv')
        .set(tenantHeaders(a, tenantA())),
      200,
    );
    expect(csv.text).toContain('Sua carteira de clientes');
    expect(csv.text).toContain(orderA.commercialId.slice(0, 12));
    expect(csv.text).not.toContain(orderB.commercialId.slice(0, 12));
    const pdf = await expectStatus(
      request(f.app)
        .get('/api/v1/reports/sales-period/export.pdf')
        .set(tenantHeaders(a, tenantA()))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        }),
      200,
    );
    expect((await pdfText(pdf.body as Buffer)).text).toContain('Sua carteira de clientes');

    // Financial reports stay closed to sellers.
    expect((await report('receivables', a)).status).toBe(403);
    expect((await report('receipts', a)).status).toBe(403);
  });

  it('segue a carteira vigente quando o cliente muda de vendedor', async () => {
    await extraSeats(f);
    const a = await seller(f, 'va');
    const b = await seller(f, 'vb');
    for (const user of [a, b]) await grantReports(user);
    const order = await confirm(f, await draft(f, a), a);
    const customer = (
      await request(f.app)
        .get(`/api/v1/customers/${order.customerId}`)
        .set(tenantHeaders(f.ownerA, tenantA()))
        .expect(200)
    ).body.data;
    await expectStatus(
      request(f.app)
        .patch(`/api/v1/customers/${order.customerId}/assignment`)
        .set(tenantHeaders(f.ownerA, tenantA()))
        .send({ assignedTo: b.uid, expectedVersion: customer.version }),
      200,
    );
    // A no longer holds the customer; B holds it but did not make the order (Pedidos rule).
    expect(metric(await view('sales-period', a), 'orders')).toBe(0);
    expect(metric(await view('sales-period', b), 'orders')).toBe(0);
    expect((await report('sales-period', a, { customerId: order.customerId })).status).toBe(404);
    expect(metric(await view('sales-period', f.ownerA), 'orders')).toBe(1);
  });
});

describe('Reativação pelo Super Admin', () => {
  it('identidade bloqueada: erro específico, nada parcial, desbloqueio e reativação preservam vínculo', async () => {
    const person = await seller(f, 'bloqueada');
    await grantReports(person);
    await expectStatus(platformStatus(person.uid, 'disabled', 2), 200);
    await f.firebase.db.doc(`identities/${person.uid}`).update({ status: 'disabled' });

    const refused = await platformStatus(person.uid, 'active', 3);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('IDENTITY_DISABLED');
    expect(await member(person.uid)).toMatchObject({ status: 'disabled', version: 3 });
    const detail = (
      await request(f.app)
        .get(`/api/v1/admin/companies/${tenantA()}`)
        .set(bearer(f.platform))
        .expect(200)
    ).body.data;
    expect(detail.users.find((u: { uid: string }) => u.uid === person.uid).accountBlocked).toBe(
      true,
    );

    await expectStatus(
      request(f.app)
        .post(`/api/v1/admin/companies/${tenantA()}/users/${person.uid}/unblock`)
        .set(bearer(f.platform))
        .send({ reason: 'Bloqueio indevido' }),
      200,
    );
    // Unblocking never reactivates an access by itself.
    expect((await member(person.uid)).status).toBe('disabled');
    await expectStatus(platformStatus(person.uid, 'active', 3), 200);
    const after = await member(person.uid);
    expect(after).toMatchObject({ status: 'active', role: 'seller', version: 4 });
    expect(after.operations).toEqual(expect.arrayContaining(['reports.view']));
    await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(person, tenantA()))
      .expect(200);
    const logs = await f.firebase.db
      .collection('auditLogs')
      .where('tenantId', '==', tenantA())
      .where('resourceId', '==', person.uid)
      .get();
    expect(logs.docs.map((d) => d.get('action')).sort()).toEqual([
      'identity.unblocked',
      'membership.updated',
      'membership.updated',
    ]);
  });

  it('login bloqueado no provedor também é identificado e desbloqueado', async () => {
    const person = await seller(f, 'login');
    await expectStatus(platformStatus(person.uid, 'disabled', 1), 200);
    await f.firebase.auth.updateUser(person.uid, { disabled: true });
    expect((await platformStatus(person.uid, 'active', 2)).body.error.code).toBe(
      'IDENTITY_DISABLED',
    );
    await expectStatus(
      request(f.app)
        .post(`/api/v1/admin/companies/${tenantA()}/users/${person.uid}/unblock`)
        .set(bearer(f.platform))
        .send({ reason: 'Login liberado' }),
      200,
    );
    expect((await f.firebase.auth.getUser(person.uid)).disabled).toBe(false);
    await expectStatus(platformStatus(person.uid, 'active', 2), 200);
  });

  it('reativação sem vaga é recusada com o limite, não com pedido de senha', async () => {
    const person = await seller(f, 'sem-vaga');
    await expectStatus(platformStatus(person.uid, 'disabled', 1), 200);
    await expectStatus(
      request(f.app)
        .post(`/api/v1/admin/companies/${tenantA()}/invitations`)
        .set(bearer(f.platform))
        .send({ email: 'outra@example.invalid', role: 'seller', reason: 'Substituição' }),
      201,
    );
    const refused = await platformStatus(person.uid, 'active', 2);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('USER_LIMIT_REACHED');
  });

  it('distingue login antigo (senha) de falta de autorização', async () => {
    await request(f.app)
      .get(`/api/v1/admin/companies/${tenantA()}`)
      .set(bearer(f.ownerA))
      .expect(403)
      .expect((r) => expect(r.body.error.code).toBe('FORBIDDEN'));
    f.offset = 301_000;
    await request(f.app)
      .get(`/api/v1/admin/companies/${tenantA()}`)
      .set(bearer(f.platform))
      .expect(403)
      .expect((r) => expect(r.body.error.code).toBe('REAUTHENTICATION_REQUIRED'));
  });
});
