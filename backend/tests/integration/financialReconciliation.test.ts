import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerFixture, newUser, join } from '../helpers/fixture.js';
import { financialOrder, receiptBody, financePost } from '../helpers/finance.js';
import { orderDocs, orderHeaders } from '../helpers/orders.js';
import { seller } from '../helpers/commercial.js';
import { reconciliationView } from '../../src/shared/schemas/finance.js';
import { digest, stableJson, encodeCursor } from '../../src/shared/utils/crypto.js';
import { financialEventHash } from '../../src/modules/finance/financialBook.js';
import { eventSchema } from '../../src/shared/schemas/finance.js';

const f = registerFixture();
async function journal(count = 4) {
  const setup = await financialOrder(f);
  for (let i = 0; i < count; i++)
    await financePost(
      f,
      `/orders/${setup.order.id}/receipts`,
      await receiptBody(f, setup.order, setup.method, 100),
    ).expect(200);
  return setup;
}
function getPage(orderId: string, limit = 1, cursor?: string | null) {
  return request(f.app)
    .get(`/api/v1/orders/${orderId}/financial-reconciliation`)
    .query({ limit: String(limit), ...(cursor ? { cursor } : {}) })
    .set(orderHeaders(f));
}
async function allPages(orderId: string, limit = 1) {
  const pages: ReturnType<typeof reconciliationView.parse>[] = [];
  let cursor: string | null = null;
  do {
    expect(pages.length).toBeLessThan(10);
    const page = reconciliationView.parse(
      (await getPage(orderId, limit, cursor).expect(200)).body.data,
    );
    pages.push(page);
    cursor = page.nextCursor;
    if (cursor) expect(cursor.length).toBeLessThanOrEqual(1024);
  } while (cursor);
  return pages;
}

describe('F01: reconciliação financeira cumulativa', () => {
  it('reconcilia pedido confirmado sem eventos e sem materializar projeções', async () => {
    const { order } = await journal(0);
    expect((await getPage(order.id).expect(200)).body.data).toEqual({
      orderId: order.id,
      consistent: true,
      complete: true,
      checkedEvents: 0,
      nextCursor: null,
    });
    expect((await orderDocs(f, 'financialOrderStates').get()).empty).toBe(true);
  });
  it.each([1, 2, 3, 25])('conta quatro eventos reais com limite %s', async (limit) => {
    const { order } = await journal();
    const pages = await allPages(order.id, limit);
    expect(pages.every((page) => page.consistent)).toBe(true);
    expect(pages.map((page) => page.checkedEvents)).toEqual(
      limit === 1 ? [1, 2, 3, 4] : limit === 2 ? [2, 4] : limit === 3 ? [3, 4] : [4],
    );
    expect(pages.at(-1)).toMatchObject({ complete: true, checkedEvents: 4, nextCursor: null });
  });
  it.each([0, 1, 2])('preserva adulteração na posição %s até a página final', async (position) => {
    const { order } = await journal();
    const events = await orderDocs(f, 'financialEvents').orderBy('sequence').get();
    await events.docs[position]!.ref.update({ amountCents: 2 });
    const pages = await allPages(order.id);
    expect(pages.slice(position).every((page) => !page.consistent)).toBe(true);
    expect(pages.at(-1)).toMatchObject({ consistent: false, complete: true, checkedEvents: 4 });
  });
  it.each([0, 1, 2])(
    'detecta ausência na posição %s sem contar evento inexistente',
    async (position) => {
      const { order } = await journal();
      const events = await orderDocs(f, 'financialEvents').orderBy('sequence').get();
      await events.docs[position]!.ref.delete();
      const pages = await allPages(order.id);
      expect(pages.map((page) => page.checkedEvents)).toEqual([1, 2, 3]);
      expect(pages.at(-1)).toMatchObject({ consistent: false, complete: true, checkedEvents: 3 });
    },
  );
  it('detecta sequência duplicada com hash próprio válido e conta todos os documentos', async () => {
    const { order } = await journal();
    const events = await orderDocs(f, 'financialEvents').orderBy('sequence').get();
    const duplicate = eventSchema.parse({ ...events.docs[1]!.data(), id: randomUUID() });
    duplicate.hash = financialEventHash(duplicate);
    await orderDocs(f, 'financialEvents').doc(duplicate.id).create(duplicate);
    expect((await allPages(order.id)).at(-1)).toMatchObject({
      consistent: false,
      complete: true,
      checkedEvents: 5,
    });
  });
  it.each(['removed', 'altered'] as const)(
    'detecta âncora %s entre páginas sem perder posição',
    async (change) => {
      const { order } = await journal();
      const first = reconciliationView.parse((await getPage(order.id).expect(200)).body.data);
      const events = await orderDocs(f, 'financialEvents').orderBy('sequence').get();
      if (change === 'removed') await events.docs[0]!.ref.delete();
      else await events.docs[0]!.ref.update({ sequence: 99, amountCents: 2 });
      const second = reconciliationView.parse(
        (await getPage(order.id, 1, first.nextCursor).expect(200)).body.data,
      );
      expect(second).toMatchObject({ consistent: false, complete: false, checkedEvents: 2 });
      const third = reconciliationView.parse(
        (await getPage(order.id, 1, second.nextCursor).expect(200)).body.data,
      );
      const fourth = reconciliationView.parse(
        (await getPage(order.id, 1, third.nextCursor).expect(200)).body.data,
      );
      expect(fourth.consistent).toBe(false);
      expect(fourth.checkedEvents).toBe(4);
      if (change === 'removed') expect(fourth.complete).toBe(true);
      else {
        const last = reconciliationView.parse(
          (await getPage(order.id, 1, fourth.nextCursor).expect(200)).body.data,
        );
        expect(last).toMatchObject({ consistent: false, complete: true, checkedEvents: 5 });
      }
    },
  );
  it.each(['removed', 'altered'] as const)('não certifica cabeça %s', async (change) => {
    const { order } = await journal();
    const events = await orderDocs(f, 'financialEvents').orderBy('sequence').get();
    if (change === 'removed') await events.docs.at(-1)!.ref.delete();
    else await events.docs.at(-1)!.ref.update({ amountCents: 2 });
    expect((await getPage(order.id).expect(409)).body.error.code).toBe('FINANCIAL_INTEGRITY');
  });
  it('rejeita continuação após recebimento e permite reiniciar na nova cabeça', async () => {
    const { order, method } = await journal();
    const first = reconciliationView.parse((await getPage(order.id).expect(200)).body.data);
    await financePost(
      f,
      `/orders/${order.id}/receipts`,
      await receiptBody(f, order, method, 100),
    ).expect(200);
    expect((await getPage(order.id, 1, first.nextCursor).expect(409)).body.error.code).toBe(
      'CONFLICT',
    );
    expect((await allPages(order.id)).at(-1)).toMatchObject({
      consistent: true,
      complete: true,
      checkedEvents: 5,
    });
  });
  it('repetir cursor em paralelo não altera contagem nem diário', async () => {
    const { order } = await journal();
    const first = reconciliationView.parse((await getPage(order.id).expect(200)).body.data);
    const [a, b] = await Promise.all([
      getPage(order.id, 1, first.nextCursor),
      getPage(order.id, 1, first.nextCursor),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.data).toEqual(b.body.data);
    expect(a.body.data).toMatchObject({ consistent: true, checkedEvents: 2 });
    expect((await allPages(order.id)).at(-1)?.checkedEvents).toBe(4);
  });
  it('rejeita cursor antigo válido explicitamente e preserva paginação do histórico', async () => {
    const { order } = await journal();
    const events = await orderDocs(f, 'financialEvents').orderBy('sequence').get();
    const scope = digest(
      stableJson({
        actor: f.ownerA.uid,
        tenantId: f.tenantA.tenant.id,
        orderId: order.id,
        kind: 'financial-reconcile',
        limit: '1',
        head: events.docs.at(-1)!.get('hash'),
      }),
    );
    const cursor = encodeCursor(f.config.invitationSecret, scope, events.docs[0]!.id);
    expect((await getPage(order.id, 1, cursor).expect(409)).body.error.code).toBe(
      'FINANCIAL_RECONCILIATION_RESTART_REQUIRED',
    );
    const path = `/api/v1/orders/${order.id}/financial-history`;
    const history = (
      await request(f.app).get(path).query({ limit: '1' }).set(orderHeaders(f)).expect(200)
    ).body.data;
    const next = (
      await request(f.app)
        .get(path)
        .query({ limit: '1', cursor: history.nextCursor })
        .set(orderHeaders(f))
        .expect(200)
    ).body.data;
    expect(next.items[0].sequence).toBe(2);
    await getPage(order.id, 1, history.nextCursor).expect(422);
  });
  it('isola cursor por ator, pedido, empresa e limite', async () => {
    const { order } = await journal();
    const first = reconciliationView.parse((await getPage(order.id).expect(200)).body.data);
    const admin = await newUser(f, 'second-admin');
    expect((await join(f, admin)).status).toBe(200);
    await getPage(order.id, 1, first.nextCursor).set(orderHeaders(f, admin)).expect(422);
    const other = await financialOrder(f);
    await getPage(other.order.id, 1, first.nextCursor).expect(422);
    await getPage(order.id, 1, first.nextCursor)
      .set(orderHeaders(f, f.ownerB, f.tenantB.tenant.id))
      .expect(404);
    await getPage(order.id, 2, first.nextCursor).expect(422);
  });
  it('revalida permissão atual e rejeita cursor adulterado', async () => {
    const { order } = await journal();
    const user = await seller(f);
    const first = reconciliationView.parse((await getPage(order.id).expect(200)).body.data);
    await getPage(order.id, 1, first.nextCursor).set(orderHeaders(f, user)).expect(403);
    const cursor = first.nextCursor!;
    await getPage(order.id, 1, `${cursor.slice(0, -1)}${cursor.endsWith('A') ? 'B' : 'A'}`).expect(
      422,
    );
    await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/memberships/${f.ownerA.uid}`)
      .update({ status: 'disabled' });
    await getPage(order.id, 1, cursor).expect(403);
  });
});
