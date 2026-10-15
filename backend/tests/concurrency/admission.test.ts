import { describe, it, expect } from 'vitest';
import request from 'supertest';
import {
  registerFixture,
  newUser,
  issue,
  join,
  bearer,
  tenantHeaders,
} from '../helpers/fixture.js';
const f = registerFixture();
describe('Invariantes sob concorrência no Firestore Emulator', () => {
  it('dois convites disputando última vaga resultam em somente uma reserva', async () => {
    const [first, second] = await Promise.all([newUser(f, 'first'), newUser(f, 'second')]);
    const results = await Promise.all([issue(f, first), issue(f, second)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe('USER_LIMIT_REACHED');
    const pending = await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/invitations`)
      .where('status', '==', 'pending')
      .get();
    expect(pending.size).toBe(1);
    expect(
      (await f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}`).get()).data()?.activeUsers,
    ).toBe(1);
  });
  it('aceitação simultânea do mesmo convite cria um vínculo e uma auditoria', async () => {
    const invitation = await issue(f, f.outsider);
    const accept = () =>
      request(f.app)
        .post('/api/v1/users/invitations/accept')
        .set(bearer(f.outsider))
        .send({ token: invitation.body.data.token });
    const results = await Promise.all([accept(), accept()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    const tenant = (await f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}`).get()).data();
    expect(tenant?.activeUsers).toBe(2);
    expect(tenant?.activeAdmins).toBe(2);
    const logs = await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/auditLogs`)
      .where('action', '==', 'invitation.accepted')
      .where('resourceId', '==', invitation.body.data.invitation.id)
      .get();
    expect(logs.size).toBe(1);
  });
  it('dois administradores se desativando simultaneamente preservam um ativo', async () => {
    const second = await newUser(f, 'second');
    expect((await join(f, second)).status).toBe(200);
    const disable = (actor: typeof second) =>
      request(f.app)
        .patch(`/api/v1/users/${actor.uid}/status`)
        .set(tenantHeaders(actor, f.tenantA.tenant.id))
        .send({ expectedVersion: 1, status: 'disabled' });
    const results = await Promise.all([disable(f.ownerA), disable(second)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe('LAST_ADMIN_REQUIRED');
    const tenant = (await f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}`).get()).data();
    expect(tenant?.activeUsers).toBe(1);
    expect(tenant?.activeAdmins).toBe(1);
    const memberships = await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/memberships`)
      .where('status', '==', 'active')
      .get();
    expect(memberships.size).toBe(1);
  });
});
