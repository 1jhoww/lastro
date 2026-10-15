import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture, tenantHeaders, bearer } from '../helpers/fixture.js';
import { configure, publicPath, catalogConfig } from '../helpers/catalog.js';
import { seller } from '../helpers/commercial.js';
import { createApp } from '../../src/app/app.js';
import * as audit from '../../src/shared/audit/audit.js';
import { AccessService } from '../../src/modules/auth/accessService.js';
const f = registerFixture();
beforeEach(() => {
  f.app = createApp(f.config, f.firebase, () => new Date(Date.now() + f.offset));
});
describe('F1 configuração administrativa do catálogo', () => {
  it('configuração ausente não publica empresa e administrador configura com versão e auditoria', async () => {
    expect(
      (
        await request(f.app)
          .get('/api/v1/catalog-settings')
          .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
          .expect(200)
      ).body.data.catalog,
    ).toBeNull();
    await request(f.app).get(publicPath()).expect(404);
    const value = (await configure(f).expect(200)).body.data;
    expect(value).toMatchObject({ slug: 'lastro-a', version: 1, enabled: true });
    const publicValue = (await request(f.app).get(publicPath()).expect(200)).body.data;
    expect(Object.keys(publicValue).sort()).toEqual([
      'description',
      'showPrices',
      'slug',
      'tradeName',
      'whatsappNumber',
    ]);
    expect(
      (
        await f.firebase.db
          .collection(`tenants/${f.tenantA.tenant.id}/auditLogs`)
          .where('action', '==', 'catalog.configured')
          .get()
      ).size,
    ).toBe(1);
  });
  it('mesma chave concorrente produz uma configuração; intenção alterada e versão antiga falham', async () => {
    const key = randomUUID(),
      results = await Promise.all([configure(f, {}, key), configure(f, {}, key)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0]!.body.data).toEqual(results[1]!.body.data);
    await configure(f, { tradeName: 'Outra intenção' }, key).expect(409);
    await configure(f).expect(409);
    expect(
      (await f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/catalogOperations`).get())
        .size,
    ).toBe(1);
  });
  it('duas empresas concorrentes não reservam o mesmo slug', async () => {
    const results = await Promise.all([
      configure(f),
      configure(f, {}, randomUUID(), f.ownerB, f.tenantB.tenant.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await f.firebase.db.collection('catalogSlugs').get()).size).toBe(1);
  });
  it('troca de slug desativa URL antiga e impede apropriação por outra empresa', async () => {
    await configure(f).expect(200);
    await configure(f, { expectedVersion: 1, slug: 'lastro-novo' }).expect(200);
    await request(f.app).get(publicPath()).expect(404);
    await request(f.app).get(publicPath('', 'lastro-novo')).expect(200);
    await configure(f, {}, randomUUID(), f.ownerB, f.tenantB.tenant.id).expect(409);
    await configure(f, { expectedVersion: 2 }).expect(200);
    await request(f.app).get(publicPath()).expect(200);
  });
  it('catálogo desativado e empresa não autorizada retornam indisponibilidade uniforme', async () => {
    await configure(f, { enabled: false }).expect(200);
    const disabled = await request(f.app).get(publicPath()).expect(404),
      missing = await request(f.app).get(publicPath('', 'desconhecido')).expect(404);
    expect(disabled.body.error.code).toBe(missing.body.error.code);
    await configure(f, { expectedVersion: 1 }).expect(200);
    for (const status of ['past_due', 'suspended', 'canceled'] as const) {
      await f.firebase.db.doc(`subscriptions/${f.tenantA.subscription.id}`).update({ status });
      await request(f.app)
        .get(publicPath())
        .expect(status === 'past_due' ? 200 : 404);
    }
    await f.firebase.db
      .doc(`subscriptions/${f.tenantA.subscription.id}`)
      .update({ status: 'active' });
    await f.firebase.db.doc(`tenants/${f.tenantA.tenant.id}`).update({ status: 'provisioning' });
    await request(f.app).get(publicPath()).expect(404);
  });
  it('vendedor e plataforma sem vínculo não leem ou modificam configuração', async () => {
    const user = await seller(f);
    await request(f.app)
      .get('/api/v1/catalog-settings')
      .set(tenantHeaders(user, f.tenantA.tenant.id))
      .expect(403);
    await configure(f, {}, randomUUID(), user).expect(403);
    await request(f.app)
      .put('/api/v1/catalog-settings')
      .set(bearer(f.platform))
      .set('Idempotency-Key', randomUUID())
      .send(catalogConfig())
      .expect(403);
    await request(f.app).get('/api/v1/catalog-settings').expect(401);
  });
  it('revogação após middleware e replay relê autorização atual', async () => {
    const key = randomUUID();
    await configure(f, {}, key).expect(200);
    await f.firebase.db
      .doc(`subscriptions/${f.tenantA.subscription.id}`)
      .update({ status: 'suspended' });
    await configure(f, {}, key).expect(403);
    await f.firebase.db
      .doc(`subscriptions/${f.tenantA.subscription.id}`)
      .update({ status: 'active' });
    const original = AccessService.prototype.tenant;
    let injected = false;
    const spy = vi.spyOn(AccessService.prototype, 'tenant').mockImplementation(async function (
      this: AccessService,
      ...args
    ) {
      if (args[3] && !injected) {
        injected = true;
        await f.firebase.db
          .doc(`tenants/${f.tenantA.tenant.id}/memberships/${f.ownerA.uid}`)
          .update({ role: 'seller' });
      }
      return original.apply(this, args);
    });
    try {
      await configure(f, { expectedVersion: 1, enabled: false }).expect(403);
    } finally {
      spy.mockRestore();
    }
    await request(f.app).get(publicPath()).expect(200);
  });
  it('falha após staging não deixa slug, configuração ou operação órfãos e permite retry', async () => {
    const original = audit.recordAudit,
      key = randomUUID(),
      spy = vi.spyOn(audit, 'recordAudit').mockImplementation((...args) => {
        original(...args);
        throw new Error('Falha sintética catálogo');
      });
    try {
      await configure(f, {}, key).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await f.firebase.db.collection('catalogSlugs').get()).size).toBe(0);
    expect(
      (await f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/catalogSettings`).get()).size,
    ).toBe(0);
    expect(
      (await f.firebase.db.collection(`tenants/${f.tenantA.tenant.id}/catalogOperations`).get())
        .size,
    ).toBe(0);
    await configure(f, {}, key).expect(200);
  });
});
