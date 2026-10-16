import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { registerFixture, tenantHeaders, bearer } from '../helpers/fixture.js';
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
const createCustomer = (body: object = customerInput) =>
  request(f.app)
    .post('/api/v1/customers')
    .set(headers())
    .send({ address: validAddress, ...body });
const createProduct = (body: object = productInput()) =>
  request(f.app).post('/api/v1/products').set(headers()).send(body);
describe('Clientes e carteiras', () => {
  it('troca de documento duplicado falha sem perder a reserva anterior', async () => {
    const first = await createCustomer().expect(201);
    await createCustomer({ name: 'Segundo', document: '11222333000181' }).expect(201);
    await request(f.app)
      .patch(`/api/v1/customers/${first.body.data.id}`)
      .set(headers())
      .send({ expectedVersion: 1, document: '11222333000181' })
      .expect(409);
    await createCustomer().expect(409);
    expect(
      (
        await request(f.app)
          .get(`/api/v1/customers/${first.body.data.id}`)
          .set(headers())
          .expect(200)
      ).body.data.version,
    ).toBe(1);
  });
  it('normaliza cadastro, exige endereço completo e registra autores', async () => {
    await createCustomer({
      ...customerInput,
      address: { city: 'São Paulo', state: 'SP' },
    }).expect(422);
    await request(f.app)
      .post('/api/v1/customers')
      .set(headers())
      .send({ name: 'Sem endereço' })
      .expect(422);
    const result = await createCustomer({
      ...customerInput,
      address: { ...validAddress, number: 'S/N', city: ' São Paulo ', state: 'sp' },
    }).expect(201);
    expect(result.body.data).toMatchObject({
      document: '52998224725',
      assignedTo: null,
      phone: '11999990000',
      createdBy: f.ownerA.uid,
      address: { number: 'S/N', city: 'São Paulo', state: 'SP', postalCode: '01310100' },
    });
    expect(result.body.data.tenantId).toBeUndefined();
    const without = await createCustomer({ name: 'Sem documento' }).expect(201);
    expect(without.body.data.document).toBeNull();
  });
  it('preserva unicidade por tenant e permite mesmo documento em outra empresa', async () => {
    await createCustomer().expect(201);
    await createCustomer().expect(409);
    await request(f.app)
      .post('/api/v1/customers')
      .set(tenantHeaders(f.ownerB, f.tenantB.tenant.id))
      .send(customerInput)
      .expect(201);
    await createCustomer({ name: 'Inválido', document: '52998224724' }).expect(422);
    await createCustomer({ name: 'CNPJ alfanumérico', document: '12.ABC.345/01DE-35' }).expect(201);
  });
  it('edita, desativa logicamente, mantém documento reservado e reativa', async () => {
    const result = await createCustomer().expect(201);
    const path = `/api/v1/customers/${result.body.data.id}`;
    await request(f.app)
      .patch(path)
      .set(headers())
      .send({ expectedVersion: 1, name: 'Nome alterado', document: null })
      .expect(200);
    await createCustomer().expect(201);
    await request(f.app).delete(path).set(headers()).send({ expectedVersion: 2 }).expect(200);
    expect(
      (
        await f.firebase.db
          .doc(`tenants/${f.tenantA.tenant.id}/customers/${result.body.data.id}`)
          .get()
      ).get('status'),
    ).toBe('inactive');
    await request(f.app)
      .patch(path)
      .set(headers())
      .send({ expectedVersion: 3, status: 'active' })
      .expect(200);
    const reserved = await createCustomer({ name: 'Outro', document: '11222333000181' }).expect(
      201,
    );
    await request(f.app)
      .delete(`/api/v1/customers/${reserved.body.data.id}`)
      .set(headers())
      .send({ expectedVersion: 1 })
      .expect(200);
    await createCustomer({ name: 'Duplicado inativo', document: '11222333000181' }).expect(409);
  });
  it('pagina com prefixo sem acentos, filtros e ordem controlada', async () => {
    for (const name of ['Árvore A', 'Arvore B', 'Zebra'])
      await createCustomer({ name }).expect(201);
    const first = await request(f.app)
      .get('/api/v1/customers?q=arv&limit=1&assignedTo=unassigned')
      .set(headers())
      .expect(200);
    expect(first.body.data.items[0].name).toBe('Árvore A');
    const second = await request(f.app)
      .get('/api/v1/customers')
      .query({ q: 'arv', limit: '1', assignedTo: 'unassigned', cursor: first.body.data.nextCursor })
      .set(headers())
      .expect(200);
    expect(second.body.data.items[0].name).toBe('Arvore B');
    expect(second.body.data.nextCursor).toBeNull();
    await request(f.app).get('/api/v1/customers?q=arv&sort=createdAt').set(headers()).expect(422);
    const descending = await request(f.app)
      .get('/api/v1/customers?direction=desc')
      .set(headers())
      .expect(200);
    expect(descending.body.data.items[0].name).toBe('Zebra');
  });
  it('deriva responsável do vendedor e restringe leitura/edição à carteira', async () => {
    const user = await seller(f);
    const sellerHeaders = tenantHeaders(user, f.tenantA.tenant.id);
    const own = await request(f.app)
      .post('/api/v1/customers')
      .set(sellerHeaders)
      .send({ name: 'Da carteira', notes: 'Nota comercial', address: validAddress })
      .expect(201);
    const privateCustomer = await createCustomer({ name: 'Sem responsável' }).expect(201);
    expect(own.body.data.assignedTo).toBe(user.uid);
    const list = await request(f.app).get('/api/v1/customers').set(sellerHeaders).expect(200);
    expect(list.body.data.items.map((v: { id: string }) => v.id)).toEqual([own.body.data.id]);
    await request(f.app)
      .patch(`/api/v1/customers/${own.body.data.id}`)
      .set(sellerHeaders)
      .send({ expectedVersion: 1, notes: 'Atualizada' })
      .expect(200);
    await request(f.app)
      .get(`/api/v1/customers/${privateCustomer.body.data.id}`)
      .set(sellerHeaders)
      .expect(404);
    expect(
      (await request(f.app).get('/api/v1/customers').set(headers()).expect(200)).body.data.items,
    ).toHaveLength(2);
  });
  it('cliente antigo sem endereço segue legível e só completa o endereço ao editar', async () => {
    const created = await createCustomer({ name: 'Cadastro antigo' }).expect(201);
    const id = created.body.data.id as string;
    const path = `/api/v1/customers/${id}`;
    // Simula um registro gravado antes da obrigatoriedade.
    await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/customers/${id}`)
      .update({ address: null });
    expect(
      (await request(f.app).get(path).set(headers()).expect(200)).body.data.address,
    ).toBeNull();
    const list = await request(f.app).get('/api/v1/customers').set(headers()).expect(200);
    expect(list.body.data.items.map((v: { id: string }) => v.id)).toContain(id);
    await request(f.app).delete(path).set(headers()).send({ expectedVersion: 1 }).expect(200);
    await request(f.app)
      .patch(path)
      .set(headers())
      .send({ expectedVersion: 2, status: 'active', notes: 'Sem tocar no endereço' })
      .expect(200);
    for (const address of [
      null,
      {},
      { city: 'São Paulo', state: 'SP' },
      { ...validAddress, number: '' },
    ])
      await request(f.app)
        .patch(path)
        .set(headers())
        .send({ expectedVersion: 3, address })
        .expect(422);
    const completed = await request(f.app)
      .patch(path)
      .set(headers())
      .send({ expectedVersion: 3, address: { ...validAddress, number: 'S/N' } })
      .expect(200);
    expect(completed.body.data.address).toMatchObject({ number: 'S/N', postalCode: '01310100' });
    await request(f.app)
      .patch(path)
      .set(headers())
      .send({ expectedVersion: 4, address: null })
      .expect(422);
  });
  it('busca exata por CPF/CNPJ respeita carteira, situação e empresa', async () => {
    const user = await seller(f);
    const sellerHeaders = tenantHeaders(user, f.tenantA.tenant.id);
    const mine = await request(f.app)
      .post('/api/v1/customers')
      .set(sellerHeaders)
      .send(customerInput)
      .expect(201);
    const other = await createCustomer({
      name: 'Outra carteira',
      document: '11222333000181',
    }).expect(201);
    const find = (h: Record<string, string>, document: string, extra: object = {}) =>
      request(f.app)
        .get('/api/v1/customers')
        .query({ document, ...extra })
        .set(h);
    const ids = (r: { body: { data: { items: { id: string }[] } } }) =>
      r.body.data.items.map((v) => v.id);
    expect(ids(await find(headers(), '529.982.247-25').expect(200))).toEqual([mine.body.data.id]);
    expect(ids(await find(sellerHeaders, '52998224725').expect(200))).toEqual([mine.body.data.id]);
    expect(ids(await find(headers(), '11.222.333/0001-81').expect(200))).toEqual([
      other.body.data.id,
    ]);
    // Fora da carteira do vendedor: nada, sem revelar que existe.
    expect(ids(await find(sellerHeaders, '11222333000181').expect(200))).toEqual([]);
    expect(
      ids(await find(headers(), '11222333000181', { status: 'inactive' }).expect(200)),
    ).toEqual([]);
    expect(
      ids(await find(headers(), '11222333000181', { assignedTo: 'unassigned' }).expect(200)),
    ).toEqual([other.body.data.id]);
    await find(headers(), '123').expect(422);
    expect(
      ids(await find(tenantHeaders(f.ownerB, f.tenantB.tenant.id), '52998224725').expect(200)),
    ).toEqual([]);
  });
  it('transferência é auditada, imediatamente altera acesso e admite cliente sem vendedor', async () => {
    await extraSeats(f);
    const first = await seller(f, 'first');
    const second = await seller(f, 'second');
    const result = await createCustomer({ name: 'Transferência', assignedTo: first.uid }).expect(
      201,
    );
    const path = `/api/v1/customers/${result.body.data.id}`;
    await request(f.app)
      .patch(`${path}/assignment`)
      .set(headers())
      .send({ expectedVersion: 1, assignedTo: second.uid })
      .expect(200);
    await request(f.app).get(path).set(tenantHeaders(first, f.tenantA.tenant.id)).expect(404);
    await request(f.app).get(path).set(tenantHeaders(second, f.tenantA.tenant.id)).expect(200);
    const audits = await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/auditLogs`)
      .where('action', '==', 'customer.assignment.changed')
      .get();
    expect(audits.docs[0]!.get('changes')).toMatchObject({
      previousAssignee: first.uid,
      assignedTo: second.uid,
    });
    await request(f.app)
      .patch(`${path}/assignment`)
      .set(headers())
      .send({ expectedVersion: 2, assignedTo: null })
      .expect(200);
    await request(f.app).get(path).set(tenantHeaders(second, f.tenantA.tenant.id)).expect(404);
  });
});
describe('Produtos, categorias e imagens privadas', () => {
  it('troca para SKU ocupado falha sem liberar SKU ou alterar preço', async () => {
    const first = await createProduct(productInput('FIRST')).expect(201);
    await createProduct(productInput('SECOND')).expect(201);
    await request(f.app)
      .patch(`/api/v1/products/${first.body.data.id}`)
      .set(headers())
      .send({ expectedVersion: 1, sku: 'SECOND', priceCents: 1 })
      .expect(409);
    await createProduct(productInput('FIRST')).expect(409);
    expect(
      (
        await request(f.app)
          .get(`/api/v1/products/${first.body.data.id}`)
          .set(headers())
          .expect(200)
      ).body.data,
    ).toMatchObject({ version: 1, priceCents: 2050, sku: 'FIRST' });
  });
  it('cria categoria/produto, normaliza SKU e retorna precisão sem estoque', async () => {
    const category = await request(f.app)
      .post('/api/v1/categories')
      .set(headers())
      .send({ name: 'Rações' })
      .expect(201);
    const product = await createProduct({
      ...productInput(' code-01 '),
      unit: 'KG',
      categoryId: category.body.data.id,
      catalogVisible: true,
    }).expect(201);
    expect(product.body.data).toMatchObject({
      sku: 'CODE-01',
      quantityPrecision: 3,
      priceCents: 2050,
      image: null,
      catalogVisible: true,
    });
    await request(f.app).get(`/api/v1/products/${product.body.data.id}`).set(headers()).expect(200);
    await request(f.app)
      .get(`/api/v1/categories/${category.body.data.id}`)
      .set(headers())
      .expect(200);
  });
  it('garante SKU único, isolamento da reserva e invalida preço fracionário/negativo', async () => {
    await createProduct(productInput('abc')).expect(201);
    await createProduct(productInput(' ABC ')).expect(409);
    await request(f.app)
      .post('/api/v1/products')
      .set(tenantHeaders(f.ownerB, f.tenantB.tenant.id))
      .send(productInput('abc'))
      .expect(201);
    for (const priceCents of [-1, 10.25])
      await createProduct({ ...productInput(), priceCents }).expect(422);
  });
  it('admin altera preço auditado com versão, desativa e reativa sem exclusão', async () => {
    const result = await createProduct(productInput('OLD')).expect(201);
    const path = `/api/v1/products/${result.body.data.id}`;
    const updated = await request(f.app)
      .patch(path)
      .set(headers())
      .send({ expectedVersion: 1, priceCents: 3050, sku: 'NEW' })
      .expect(200);
    expect(updated.body.data.priceCents).toBe(3050);
    await createProduct(productInput('OLD')).expect(201);
    await request(f.app)
      .patch(path)
      .set(headers())
      .send({ expectedVersion: 1, priceCents: 1 })
      .expect(409);
    await request(f.app).delete(path).set(headers()).send({ expectedVersion: 2 }).expect(200);
    await createProduct(productInput('NEW')).expect(409);
    await request(f.app)
      .patch(path)
      .set(headers())
      .send({ expectedVersion: 3, status: 'active' })
      .expect(200);
    const audits = await f.firebase.db
      .collection(`tenants/${f.tenantA.tenant.id}/auditLogs`)
      .where('action', '==', 'product.updated')
      .get();
    expect(
      audits.docs.some(
        (v) => v.get('changes.previousPriceCents') === 2050 && v.get('changes.priceCents') === 3050,
      ),
    ).toBe(true);
  });
  it('seller consulta apenas produtos ativos e não altera qualquer campo', async () => {
    const user = await seller(f);
    const result = await createProduct().expect(201);
    const path = `/api/v1/products/${result.body.data.id}`;
    const sh = tenantHeaders(user, f.tenantA.tenant.id);
    await request(f.app).get(path).set(sh).expect(200);
    await request(f.app)
      .patch(path)
      .set(sh)
      .send({ expectedVersion: 1, priceCents: 0 })
      .expect(403);
    await request(f.app).delete(path).set(sh).send({ expectedVersion: 1 }).expect(403);
    await request(f.app).delete(path).set(headers()).send({ expectedVersion: 1 }).expect(200);
    await request(f.app).get(path).set(sh).expect(404);
    expect(
      (await request(f.app).get('/api/v1/products').set(sh).expect(200)).body.data.items,
    ).toHaveLength(0);
    await request(f.app).get('/api/v1/products?status=all').set(sh).expect(403);
  });
  it('filtra produtos por categoria/SKU/visibilidade com paginação e prefixo', async () => {
    const category = await request(f.app)
      .post('/api/v1/categories')
      .set(headers())
      .send({ name: 'Categoria' })
      .expect(201);
    for (const name of ['Produto A', 'Produto B'])
      await createProduct({
        ...productInput(),
        name,
        categoryId: category.body.data.id,
        catalogVisible: true,
      }).expect(201);
    await createProduct({ ...productInput('hidden'), name: 'Outro' }).expect(201);
    const first = await request(f.app)
      .get('/api/v1/products')
      .query({ q: 'pro', categoryId: category.body.data.id, catalogVisible: 'true', limit: '1' })
      .set(headers())
      .expect(200);
    expect(first.body.data.items).toHaveLength(1);
    const second = await request(f.app)
      .get('/api/v1/products')
      .query({
        q: 'pro',
        categoryId: category.body.data.id,
        catalogVisible: 'true',
        limit: '1',
        cursor: first.body.data.nextCursor,
      })
      .set(headers())
      .expect(200);
    expect(second.body.data.items[0].name).toBe('Produto B');
    expect(
      (await request(f.app).get('/api/v1/products?sku=hidden').set(headers()).expect(200)).body.data
        .items,
    ).toHaveLength(1);
  });
  it('categoria inativa preserva produtos existentes e impede novas vinculações', async () => {
    const result = await request(f.app)
      .post('/api/v1/categories')
      .set(headers())
      .send({ name: 'Original' })
      .expect(201);
    const product = await createProduct({
      ...productInput(),
      categoryId: result.body.data.id,
    }).expect(201);
    const path = `/api/v1/categories/${result.body.data.id}`;
    await request(f.app)
      .patch(path)
      .set(headers())
      .send({ expectedVersion: 1, name: 'Alterada' })
      .expect(200);
    await request(f.app).delete(path).set(headers()).send({ expectedVersion: 2 }).expect(200);
    await createProduct({ ...productInput(), categoryId: result.body.data.id }).expect(422);
    expect(
      (
        await request(f.app)
          .get(`/api/v1/products/${product.body.data.id}`)
          .set(headers())
          .expect(200)
      ).body.data.categoryId,
    ).toBe(result.body.data.id);
    const user = await seller(f);
    await request(f.app).get(path).set(tenantHeaders(user, f.tenantA.tenant.id)).expect(200);
    await request(f.app)
      .patch(path)
      .set(headers())
      .send({ expectedVersion: 3, status: 'active' })
      .expect(200);
    await request(f.app).get('/api/v1/categories?q=alter&status=all').set(headers()).expect(200);
  });
  it('upload, leitura e remoção reais no Storage Emulator sem token público', async () => {
    const result = await createProduct().expect(201);
    const path = `/api/v1/products/${result.body.data.id}/image`;
    const uploaded = await request(f.app)
      .put(`${path}?expectedVersion=1`)
      .set(headers())
      .set('Content-Type', 'image/png')
      .send(await png())
      .expect(200);
    expect(uploaded.body.data.image.contentType).toBe('image/webp');
    const read = await request(f.app).get(path).set(headers()).expect(200);
    expect(read.headers['cache-control']).toBe('private, no-store');
    expect(read.headers['content-type']).toMatch(/^image\/webp/);
    const [files] = await f.firebase.bucket.getFiles({ prefix: `tenants/${f.tenantA.tenant.id}/` });
    const [metadata] = await files[0]!.getMetadata();
    expect(metadata.metadata?.firebaseStorageDownloadTokens).toBeUndefined();
    await request(f.app).delete(`${path}?expectedVersion=2`).set(headers()).expect(200);
    await request(f.app).get(path).set(headers()).expect(404);
  });
  it('suspensão/cancelamento bloqueiam todos os novos grupos', async () => {
    const customer = await createCustomer().expect(201);
    const product = await createProduct().expect(201);
    for (const [status, expectedVersion] of [
      ['suspended', 1],
      ['canceled', 2],
    ] as const) {
      await request(f.app)
        .patch(`/api/v1/admin/subscriptions/${f.tenantA.subscription.id}`)
        .set(bearer(f.platform))
        .send({ expectedVersion, status, reason: 'Teste de bloqueio' })
        .expect(200);
      for (const path of [
        '/customers',
        `/customers/${customer.body.data.id}`,
        '/products',
        `/products/${product.body.data.id}/image`,
        '/categories',
      ])
        await request(f.app).get(`/api/v1${path}`).set(headers()).expect(403);
      await createCustomer({ name: 'Bloqueado' }).expect(403);
      await createProduct().expect(403);
    }
  });
});
