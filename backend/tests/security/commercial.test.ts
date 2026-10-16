import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { registerFixture, tenantHeaders, bearer, blockSubscription } from '../helpers/fixture.js';
import { seller, extraSeats, productInput, png, validAddress } from '../helpers/commercial.js';
const f = registerFixture();
const ah = () => tenantHeaders(f.ownerA, f.tenantA.tenant.id);
const bh = () => tenantHeaders(f.ownerB, f.tenantB.tenant.id);
describe('Autorização dos módulos comerciais', () => {
  it('nega BOLA entre tenants em todos os recursos e no contexto manipulado', async () => {
    for (const [collection, body] of [
      ['customers', { name: 'Privado B', address: validAddress }],
      ['products', productInput()],
      ['categories', { name: 'Privado B' }],
    ] as const) {
      const created = await request(f.app)
        .post(`/api/v1/${collection}`)
        .set(bh())
        .send(body)
        .expect(201);
      await request(f.app)
        .get(`/api/v1/${collection}/${created.body.data.id}`)
        .set(ah())
        .expect(404);
      await request(f.app)
        .get(`/api/v1/${collection}`)
        .set(tenantHeaders(f.ownerA, f.tenantB.tenant.id))
        .expect(403);
      await request(f.app)
        .patch(`/api/v1/${collection}/${created.body.data.id}`)
        .set(ah())
        .send({ expectedVersion: 1, name: 'Tentativa' })
        .expect(404);
    }
  });
  it('vendedor não lê nem edita carteira alheia mesmo com filtros e IDs', async () => {
    await extraSeats(f);
    const first = await seller(f, 'first');
    const second = await seller(f, 'second');
    const sh = tenantHeaders(first, f.tenantA.tenant.id);
    const other = await request(f.app)
      .post('/api/v1/customers')
      .set(ah())
      .send({ address: validAddress, name: 'Outro vendedor', assignedTo: second.uid })
      .expect(201);
    await request(f.app).get(`/api/v1/customers/${other.body.data.id}`).set(sh).expect(404);
    await request(f.app)
      .patch(`/api/v1/customers/${other.body.data.id}`)
      .set(sh)
      .send({ expectedVersion: 1, notes: 'Não autorizado' })
      .expect(404);
    for (const assignedTo of [second.uid, 'unassigned'])
      await request(f.app).get('/api/v1/customers').query({ assignedTo }).set(sh).expect(403);
  });
  it('seller não transfere, escolhe responsável, desativa ou altera status', async () => {
    const user = await seller(f);
    const sh = tenantHeaders(user, f.tenantA.tenant.id);
    await request(f.app)
      .post('/api/v1/customers')
      .set(sh)
      .send({ address: validAddress, name: 'Forjado', assignedTo: user.uid })
      .expect(403);
    const own = await request(f.app)
      .post('/api/v1/customers')
      .set(sh)
      .send({ address: validAddress, name: 'Próprio' })
      .expect(201);
    const path = `/api/v1/customers/${own.body.data.id}`;
    await request(f.app)
      .patch(`${path}/assignment`)
      .set(sh)
      .send({ assignedTo: null, expectedVersion: 1 })
      .expect(403);
    await request(f.app)
      .patch(path)
      .set(sh)
      .send({ assignedTo: null, expectedVersion: 1 })
      .expect(422);
    await request(f.app)
      .patch(path)
      .set(sh)
      .send({ status: 'inactive', expectedVersion: 1 })
      .expect(403);
    await request(f.app).delete(path).set(sh).send({ expectedVersion: 1 }).expect(403);
  });
  it('não atribui a identidade sem vínculo, admin, desativado ou vendedor de outra empresa', async () => {
    const other = await seller(f, 'seller-b', f.tenantB.tenant.id);
    const user = await seller(f);
    await request(f.app)
      .patch(`/api/v1/users/${user.uid}/status`)
      .set(ah())
      .send({ expectedVersion: 1, status: 'disabled' })
      .expect(200);
    for (const assignedTo of [f.outsider.uid, f.ownerA.uid, other.uid, user.uid])
      await request(f.app)
        .post('/api/v1/customers')
        .set(ah())
        .send({ address: validAddress, name: 'Tentativa', assignedTo })
        .expect(422);
    const created = await request(f.app)
      .post('/api/v1/customers')
      .set(ah())
      .send({ address: validAddress, name: 'Sem responsável' })
      .expect(201);
    await request(f.app)
      .patch(`/api/v1/customers/${created.body.data.id}/assignment`)
      .set(ah())
      .send({ expectedVersion: 1, assignedTo: other.uid })
      .expect(422);
  });
  it('rejeita mass assignment, caminhos e paginação abusiva', async () => {
    for (const field of [
      'tenantId',
      'createdBy',
      'version',
      'permissions',
      'profile',
      'image',
      'nameKey',
    ]) {
      await request(f.app)
        .post('/api/v1/customers')
        .set(ah())
        .send({ address: validAddress, name: 'Teste', [field]: 'forjado' })
        .expect(422);
      await request(f.app)
        .post('/api/v1/products')
        .set(ah())
        .send({ ...productInput(), [field]: 'forjado' })
        .expect(422);
    }
    for (const path of [
      '/customers?limit=101',
      '/products?limit=100000',
      '/categories?orderBy=priceCents',
      '/customers?tenantId=forjado',
      '/products?direction=invalid',
      '/customers/bad%2Fpath',
    ])
      await request(f.app).get(`/api/v1${path}`).set(ah()).expect(422);
  });
  it('cursores são vinculados a filtro, coleção e ator', async () => {
    for (const name of ['Nome A', 'Nome B'])
      await request(f.app)
        .post('/api/v1/customers')
        .set(ah())
        .send({ address: validAddress, name })
        .expect(201);
    const result = await request(f.app).get('/api/v1/customers?limit=1').set(ah()).expect(200);
    await request(f.app)
      .get('/api/v1/customers')
      .query({ limit: '1', q: 'nome', cursor: result.body.data.nextCursor })
      .set(ah())
      .expect(422);
    await request(f.app)
      .get('/api/v1/products')
      .query({ limit: '1', cursor: result.body.data.nextCursor })
      .set(ah())
      .expect(422);
    const user = await seller(f);
    await request(f.app)
      .get('/api/v1/customers')
      .query({ limit: '1', cursor: result.body.data.nextCursor })
      .set(tenantHeaders(user, f.tenantA.tenant.id))
      .expect(422);
  });
  it('categoria externa não pode ser vinculada e Super Admin não acessa comércio sem vínculo', async () => {
    const category = await request(f.app)
      .post('/api/v1/categories')
      .set(bh())
      .send({ name: 'Categoria B' })
      .expect(201);
    await request(f.app)
      .post('/api/v1/products')
      .set(ah())
      .send({ ...productInput(), categoryId: category.body.data.id })
      .expect(422);
    for (const group of ['customers', 'products', 'categories']) {
      await request(f.app)
        .get(`/api/v1/${group}`)
        .set(tenantHeaders(f.platform, f.tenantA.tenant.id))
        .expect(403);
      await request(f.app).get(`/api/v1/${group}`).expect(401);
    }
  });
  it('seller não cria produto, modifica categoria ou configura catálogo', async () => {
    const user = await seller(f);
    const sh = tenantHeaders(user, f.tenantA.tenant.id);
    const category = await request(f.app)
      .post('/api/v1/categories')
      .set(ah())
      .send({ name: 'Categoria' })
      .expect(201);
    const product = await request(f.app)
      .post('/api/v1/products')
      .set(ah())
      .send(productInput())
      .expect(201);
    await request(f.app).post('/api/v1/products').set(sh).send(productInput()).expect(403);
    await request(f.app).post('/api/v1/categories').set(sh).send({ name: 'Tentativa' }).expect(403);
    await request(f.app)
      .patch(`/api/v1/categories/${category.body.data.id}`)
      .set(sh)
      .send({ expectedVersion: 1, name: 'Tentativa' })
      .expect(403);
    await request(f.app)
      .patch(`/api/v1/products/${product.body.data.id}`)
      .set(sh)
      .send({ expectedVersion: 1, catalogVisible: true })
      .expect(403);
  });
});
describe('Imagens privadas', () => {
  it('bloqueia uploads maliciosos, URL, MIME forjado e limite de tamanho', async () => {
    const product = await request(f.app)
      .post('/api/v1/products')
      .set(ah())
      .send(productInput())
      .expect(201);
    const path = `/api/v1/products/${product.body.data.id}/image?expectedVersion=1`;
    await request(f.app)
      .put(path)
      .set(ah())
      .set('Content-Type', 'image/svg+xml')
      .send('<svg><script/></svg>')
      .expect(422);
    await request(f.app).put(path).set(ah()).send({ url: 'http://127.0.0.1/private' }).expect(422);
    await request(f.app)
      .put(path)
      .set(ah())
      .set('Content-Type', 'image/jpeg')
      .send(await png())
      .expect(422);
    await request(f.app)
      .put(path)
      .set(ah())
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(5 * 1024 * 1024 + 1))
      .expect(413);
    await request(f.app)
      .put(path)
      .set(ah())
      .set('Content-Type', 'image/png')
      .set('Content-Encoding', 'gzip')
      .send(Buffer.from('invalid'))
      .expect(415);
    const [files] = await f.firebase.bucket.getFiles({ prefix: 'tenants/' });
    expect(files).toHaveLength(0);
  });
  it('nega leitura/alteração por outra empresa, vendedor e cliente Storage direto', async () => {
    const product = await request(f.app)
      .post('/api/v1/products')
      .set(ah())
      .send(productInput())
      .expect(201);
    const path = `/api/v1/products/${product.body.data.id}/image`;
    await request(f.app)
      .put(`${path}?expectedVersion=1`)
      .set(ah())
      .set('Content-Type', 'image/png')
      .send(await png())
      .expect(200);
    await request(f.app).get(path).set(bh()).expect(404);
    await request(f.app)
      .put(`${path}?expectedVersion=2`)
      .set(bh())
      .set('Content-Type', 'image/png')
      .send(await png())
      .expect(404);
    const user = await seller(f);
    const sh = tenantHeaders(user, f.tenantA.tenant.id);
    await request(f.app).get(path).set(sh).expect(200);
    await request(f.app)
      .put(`${path}?expectedVersion=2`)
      .set(sh)
      .set('Content-Type', 'image/png')
      .send(await png())
      .expect(403);
    await request(f.app).delete(`${path}?expectedVersion=2`).set(sh).expect(403);
    const [files] = await f.firebase.bucket.getFiles({ prefix: 'tenants/' });
    const direct = `http://127.0.0.1:9199/v0/b/${f.firebase.bucket.name}/o/${encodeURIComponent(files[0]!.name)}?alt=media`;
    expect((await fetch(direct)).status).toBe(403);
    expect((await fetch(direct, { headers: bearer(user) })).status).toBe(403);
    expect((await fetch(direct, { method: 'DELETE', headers: bearer(user) })).status).toBe(403);
  });
  it('suspensão bloqueia upload e leitura privada', async () => {
    const product = await request(f.app)
      .post('/api/v1/products')
      .set(ah())
      .send(productInput())
      .expect(201);
    const path = `/api/v1/products/${product.body.data.id}/image`;
    await request(f.app)
      .put(`${path}?expectedVersion=1`)
      .set(ah())
      .set('Content-Type', 'image/png')
      .send(await png())
      .expect(200);
    await blockSubscription(f, 'suspended');
    await request(f.app).get(path).set(ah()).expect(403);
    await request(f.app)
      .put(`${path}?expectedVersion=2`)
      .set(ah())
      .set('Content-Type', 'image/png')
      .send(await png())
      .expect(403);
  });
  it('limite de upload é compartilhado por ator', async () => {
    const product = await request(f.app)
      .post('/api/v1/products')
      .set(ah())
      .send(productInput())
      .expect(201);
    const path = `/api/v1/products/${product.body.data.id}/image?expectedVersion=1`;
    for (let i = 0; i < 30; i++)
      await request(f.app)
        .put(path)
        .set(ah())
        .set('Content-Type', 'image/png')
        .send(Buffer.from('invalid'))
        .expect(422);
    await request(f.app)
      .put(path)
      .set(ah())
      .set('Content-Type', 'image/png')
      .send(await png())
      .expect(429);
  });
});
