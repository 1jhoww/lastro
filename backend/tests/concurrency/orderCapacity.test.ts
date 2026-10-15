import { describe, it, expect } from 'vitest';
import { registerFixture } from '../helpers/fixture.js';
import { confirm, command, orderDocs } from '../helpers/orders.js';
import { largeProducts, largeDraft, newKey } from '../helpers/largeOrders.js';
const f = registerFixture({ rateLimitMax: 10000 });
describe('Pedidos de 200 linhas concorrentes', () => {
  it('dois pedidos disputam mesmos produtos: um commit inteiro vence', async () => {
    const ids = await largeProducts(f, 200, '1'),
      a = await largeDraft(f, ids),
      b = await largeDraft(f, ids);
    const start = performance.now(),
      results = await Promise.all([command(f, a, 'confirm'), command(f, b, 'confirm')]);
    console.info(
      JSON.stringify({
        largeRace: {
          lines: 200,
          elapsedMs: Math.round(performance.now() - start),
          statuses: results.map((r) => r.status),
        },
      }),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await orderDocs(f, 'stockReservations').get()).size).toBe(200);
    expect((await orderDocs(f, 'receivables').get()).size).toBe(12);
    const orders = await orderDocs(f, 'orders').get();
    expect(orders.docs.filter((d) => d.get('status') === 'confirmed')).toHaveLength(1);
    expect(
      (await orderDocs(f, 'inventory').get()).docs.every((d) => d.get('reservedScaled') === 1000),
    ).toBe(true);
  }, 90_000);
  it('retries concorrentes de 200 linhas repetem resultado sem duplicação', async () => {
    const ids = await largeProducts(f, 200),
      o = await largeDraft(f, ids),
      key = newKey();
    const start = performance.now(),
      results = await Promise.all([
        command(f, o, 'confirm', f.ownerA, key),
        command(f, o, 'confirm', f.ownerA, key),
      ]);
    console.info(
      JSON.stringify({
        largeReplayRace: {
          lines: 200,
          elapsedMs: Math.round(performance.now() - start),
          statuses: results.map((r) => r.status),
        },
      }),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0]!.body.data).toEqual(results[1]!.body.data);
    expect((await orderDocs(f, 'stockReservations').get()).size).toBe(200);
    expect((await orderDocs(f, 'receivables').get()).size).toBe(12);
    expect((await orderDocs(f, 'inventoryMovements').get()).size).toBe(400);
  }, 90_000);
  it('expedição e cancelamento de 200 linhas não se intercalam parcialmente', async () => {
    const ids = await largeProducts(f, 200),
      o = await confirm(f, await largeDraft(f, ids));
    const results = await Promise.all([command(f, o, 'dispatch'), command(f, o, 'cancel')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const status = (await orderDocs(f, 'orders').doc(o.id).get()).get('status');
    expect(
      (await orderDocs(f, 'inventory').get()).docs.every(
        (d) =>
          d.get('reservedScaled') === 0 &&
          d.get('physicalScaled') === (status === 'dispatched' ? 1000 : 2000),
      ),
    ).toBe(true);
    expect(
      (await orderDocs(f, 'receivables').get()).docs.every(
        (d) => d.get('status') === (status === 'dispatched' ? 'open' : 'canceled'),
      ),
    ).toBe(true);
  }, 90_000);
});
