import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { registerFixture, bearer, tenantHeaders, newUser, join } from '../helpers/fixture.js';
import { createApp } from '../../src/app/app.js';
import express from 'express';
import { apiRateLimit } from '../../src/middlewares/rateLimit.js';
import { requestContext } from '../../src/middlewares/requestContext.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { FoundationRepository } from '../../src/infrastructure/repositories/foundationRepository.js';
const f = registerFixture();
function changedToken(token: string, changes: Record<string, unknown>) {
  const segments = token.split('.');
  const payload = JSON.parse(Buffer.from(segments[1] ?? '', 'base64url').toString());
  return `${segments[0]}.${Buffer.from(JSON.stringify({ ...payload, ...changes })).toString('base64url')}.`;
}
describe('Segurança e isolamento real entre empresas', () => {
  it('nega ausência de token e token inválido com erro padronizado', async () => {
    for (const token of [undefined, 'invalid-token']) {
      const agent = request(f.app).get('/api/v1/me');
      if (token) agent.set('Authorization', `Bearer ${token}`);
      const response = await agent.expect(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(response.body.error.requestId).toMatch(/^[a-f0-9-]{36}$/);
    }
  });
  it('SDK rejeita token expirado e audiência/emissor de outro projeto', async () => {
    for (const changes of [
      { exp: 1 },
      { aud: 'demo-other-project' },
      { iss: 'https://securetoken.google.com/demo-other-project' },
    ]) {
      await request(f.app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${changedToken(f.ownerA.token, changes)}`)
        .expect(401);
    }
  });
  it('bloqueia usuário desativado no Firebase e na identidade global', async () => {
    await f.firebase.auth.updateUser(f.ownerA.uid, { disabled: true });
    await request(f.app).get('/api/v1/me').set(bearer(f.ownerA)).expect(403);
    await f.firebase.db.doc(`identities/${f.ownerB.uid}`).update({ status: 'disabled' });
    await request(f.app).get('/api/v1/me').set(bearer(f.ownerB)).expect(403);
  });
  it('header de tenant, IDs ou contexto não permitem acesso cruzado', async () => {
    await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(f.ownerA, f.tenantB.tenant.id))
      .expect(403);
    await request(f.app)
      .get('/api/v1/users')
      .set(tenantHeaders(f.outsider, f.tenantA.tenant.id))
      .expect(403);
    await request(f.app)
      .patch(`/api/v1/users/${f.ownerB.uid}/role`)
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .send({ role: 'seller', expectedVersion: 1 })
      .expect(404);
    await request(f.app)
      .patch('/api/v1/tenants/current')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .send({ name: 'Tentativa', expectedVersion: 1, tenantId: f.tenantB.tenant.id })
      .expect(422);
    await request(f.app).get('/api/v1/me?tenantId=foreign').set(bearer(f.ownerA)).expect(422);
    await request(f.app)
      .get('/api/v1/tenants/current')
      .set({ ...bearer(f.ownerA), 'X-Tenant-Id': '../other' })
      .expect(403);
  });
  it('papel de plataforma não concede acesso empresarial e administrador não acessa plataforma', async () => {
    await request(f.app).get('/api/v1/admin/plans').set(bearer(f.ownerA)).expect(403);
    await request(f.app)
      .get('/api/v1/users')
      .set(tenantHeaders(f.platform, f.tenantA.tenant.id))
      .expect(403);
    await request(f.app)
      .patch(`/api/v1/admin/plans/${f.plan.id}`)
      .set(bearer(f.ownerA))
      .send({ expectedVersion: 1, userLimit: 100 })
      .expect(403);
  });
  it('vendedor não se promove nem adiciona permissões', async () => {
    const seller = await newUser(f, 'seller');
    expect((await join(f, seller, 'seller')).status).toBe(200);
    await request(f.app)
      .patch(`/api/v1/users/${seller.uid}/role`)
      .set(tenantHeaders(seller, f.tenantA.tenant.id))
      .send({ expectedVersion: 1, role: 'administrator' })
      .expect(403);
    await request(f.app)
      .patch(`/api/v1/users/${seller.uid}/role`)
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .send({ expectedVersion: 1, role: 'administrator', permissions: ['platform:manage'] })
      .expect(422);
  });
  it('convite validado pode criar vínculo adicional sem conceder acesso automático a outra empresa', async () => {
    await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(f.ownerB, f.tenantA.tenant.id))
      .expect(403);
    expect((await join(f, f.ownerB)).status).toBe(200);
    const me = await request(f.app).get('/api/v1/me').set(bearer(f.ownerB)).expect(200);
    expect(me.body.data.memberships).toHaveLength(2);
    await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(f.ownerB, f.tenantA.tenant.id))
      .expect(200);
  });
  it('CORS, tamanho de payload e JSON malformado são tratados sem detalhes internos', async () => {
    await request(f.app)
      .get('/api/v1/me')
      .set(bearer(f.ownerA))
      .set('Origin', 'https://evil.example.invalid')
      .expect(403);
    const large = await request(f.app)
      .patch('/api/v1/tenants/current')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .send({ name: 'x'.repeat(70_000) })
      .expect(413);
    expect(large.body).not.toHaveProperty('stack');
    const malformed = await request(f.app)
      .post('/api/v1/users/invitations')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .type('json')
      .send('{]')
      .expect(400);
    expect(JSON.stringify(malformed.body)).not.toContain('SyntaxError');
  });
  it('corrupção persistida vira erro sanitizado e campos secretos não aparecem nas saídas', async () => {
    const current = await request(f.app)
      .get('/api/v1/users')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(200);
    expect(JSON.stringify(current.body)).not.toContain('tokenHash');
    await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}`)
      .update({ version: 'INVALID_INTERNAL_MARKER' });
    const failure = await request(f.app)
      .get('/api/v1/tenants/current')
      .set(tenantHeaders(f.ownerA, f.tenantA.tenant.id))
      .expect(500);
    expect(failure.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(failure.body)).not.toContain('INVALID_INTERNAL_MARKER');
  });
  it('rate limit é aplicado antes de verificar token e retorna 429', async () => {
    const app = createApp({ ...f.config, rateLimitMax: 2 }, f.firebase);
    await request(app).get('/api/v1/me').expect(401);
    await request(app).get('/api/v1/me').expect(401);
    const blocked = await request(app).get('/api/v1/me').expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
  it('cliente direto não consegue ler Firestore protegido por rules', async () => {
    const response = await fetch(
      `http://127.0.0.1:8080/v1/projects/demo-lastro-tests/databases/(default)/documents/tenants/${f.tenantA.tenant.id}`,
      { headers: { Authorization: `Bearer ${f.ownerA.token}` } },
    );
    expect(response.status).toBe(403);
  });
  it('contador compartilhado aplica limite entre duas instâncias, usando somente Firestore emulado', async () => {
    const instance = () => {
      const app = express();
      app.use(
        requestContext,
        apiRateLimit(
          { ...f.config, mode: 'production', rateLimitMax: 2 },
          new FoundationRepository(f.firebase.db),
        ),
      );
      app.get('/probe', (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);
      return app;
    };
    const a = instance();
    const b = instance();
    await request(a).get('/probe').expect(200);
    await request(b).get('/probe').expect(200);
    const blocked = await request(a).get('/probe').expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
